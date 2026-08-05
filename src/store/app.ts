import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import {
  spawnPty,
  killPty,
  detectAgents,
  type PtyExit,
  type PtyOutput,
} from "../lib/pty";
import { sessionBegin } from "../lib/session";
import { publishPtyOutput, tapPtyOutput } from "../lib/bus";
import { AGENTS, type AgentKind } from "../lib/agents";
import type { SoundKind } from "../lib/sound";
import {
  collectLeaves,
  firstLeaf,
  insertSplit,
  removeLeaf,
  setRatioAt,
  type LayoutNode,
} from "../lib/layout";
import { Webview } from "@tauri-apps/api/webview";

export type PaneKind =
  | "shell"
  | "agent"
  | "replay"
  | "kanban"
  | "browser"
  | "editor";
export type PaneStatus = "running" | "exited";
export type PaneActivity = "idle" | "working" | "done";
export type DoneSource = "hook" | "bell" | "idle";

export type Pane = {
  id: string;
  ptyId: string;
  workspaceId: string;
  kind: PaneKind;
  agent?: AgentKind;
  title: string;
  status: PaneStatus;
  activity: PaneActivity;
  doneSource: DoneSource | null;
  sessionPath?: string;
  boardPath?: string;
  url?: string;
  filePath?: string;
};

export type SavedPane = Omit<
  Pane,
  "ptyId" | "status" | "activity" | "doneSource"
>;

export const DEFAULT_COLOR = "#c98f52";
const IDLE_MS = 7000;

const lastOut = new Map<string, number>();
let idleTimer: ReturnType<typeof setInterval> | undefined;

let doneHandler: ((pane: Pane, source: DoneSource) => void) | null = null;
export function setDoneHandler(
  fn: ((pane: Pane, source: DoneSource) => void) | null,
) {
  doneHandler = fn;
}

export type Workspace = {
  id: string;
  title: string;
  color: string;
  pinned: boolean;
  folder: string | null;
  createdAt: number;
  layout: LayoutNode | null;
  muted?: boolean;
  folderAsked?: boolean;
  layoutMode?: "grid" | "dock";
  dockRatio?: number;
};

export type Settings = {
  sound: SoundKind | "muted";
  notifyEnabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  sound: "chime",
  notifyEnabled: true,
};

type HookPayload = { pane_id: string; agent: string; event: string };

type AppState = {
  ready: boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  panes: Pane[];
  agents: Record<AgentKind, string | null>;
  focused: Record<string, string>;
  zoomed: Record<string, string | null>;
  hookUrl: string;
  settings: Settings;

  init: () => Promise<void>;
  createWorkspace: (title?: string) => Promise<string>;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;

  spawnShell: (workspaceId: string, dir?: "h" | "v") => Promise<void>;
  spawnAgent: (workspaceId: string, kind: AgentKind, dir?: "h" | "v") => Promise<void>;
  openReplay: (workspaceId: string, sessionPath: string, title: string) => void;
  openKanban: (workspaceId: string) => Promise<void>;
  openBrowser: (workspaceId: string) => void;
  openEditor: (workspaceId: string) => void;
  updatePane: (paneId: string, patch: Partial<Pane>) => void;
  closePane: (paneId: string) => void;
  splitPane: (paneId: string, dir: "h" | "v") => Promise<void>;
  setSplitRatio: (workspaceId: string, path: number[], ratio: number) => void;
  toggleZoom: (workspaceId: string, paneId: string) => void;
  setFocused: (workspaceId: string, paneId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  markDone: (paneId: string, source: DoneSource) => void;
  reportBell: (ptyId: string) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePersist(get: () => AppState) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { workspaces, settings } = get();
    const panes = get().panes.map(
      ({ ptyId, status, activity, doneSource, ...rest }) => rest,
    );
    void invoke("store_save", {
      json: JSON.stringify({ version: 1, workspaces, settings, panes }),
    });
  }, 400);
}

function patchWorkspace(
  s: AppState,
  id: string,
  patch: Partial<Workspace>,
): Partial<AppState> {
  return {
    workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  };
}

type SetState = (
  fn: (s: AppState) => Partial<AppState>,
) => void;
type GetState = () => AppState;

function addPane(
  set: SetState,
  get: GetState,
  pane: Pane,
  dir: "h" | "v",
) {
  set((s) => {
    const fresh = get().workspaces.find((w) => w.id === pane.workspaceId);
    const base = fresh?.layout ?? null;
    const layout = base
      ? insertSplit(
          base,
          s.focused[pane.workspaceId] ?? firstLeaf(base) ?? "",
          dir,
          pane.id,
        )
      : { type: "leaf" as const, paneId: pane.id };
    return {
      panes: [...s.panes, pane],
      focused: { ...s.focused, [pane.workspaceId]: pane.id },
      ...patchWorkspace(s, pane.workspaceId, { layout }),
    };
  });
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  workspaces: [],
  activeWorkspaceId: null,
  panes: [],
  agents: { claude: null, codex: null, opencode: null },
  focused: {},
  zoomed: {},
  hookUrl: "",
  settings: DEFAULT_SETTINGS,

  init: async () => {
    if (get().ready) return;
    await listen<PtyOutput>("pty://output", (e) => {
      publishPtyOutput(e.payload.id, e.payload.data);
    });
    await listen<PtyExit>("pty://exit", (e) => {
      set((s) => ({
        panes: s.panes.map((p) =>
          p.ptyId === e.payload.id
            ? { ...p, status: "exited", activity: "idle" }
            : p,
        ),
      }));
    });
    await listen<HookPayload>("agent://hook", (e) => {
      const pane = get().panes.find((p) => p.id === e.payload.pane_id);
      if (pane) get().markDone(pane.id, "hook");
    });

    tapPtyOutput((ptyId) => {
      lastOut.set(ptyId, Date.now());
      const pane = get().panes.find((p) => p.ptyId === ptyId);
      if (!pane || pane.kind !== "agent" || pane.status !== "running") return;
      if (pane.activity !== "working") {
        set((s) => ({
          panes: s.panes.map((p) =>
            p.id === pane.id
              ? { ...p, activity: "working", doneSource: null }
              : p,
          ),
        }));
      }
    });

    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      const now = Date.now();
      for (const pane of get().panes) {
        if (
          pane.kind !== "agent" ||
          pane.status !== "running" ||
          pane.activity !== "working"
        )
          continue;
        const t = lastOut.get(pane.ptyId) ?? 0;
        if (t > 0 && now - t > IDLE_MS) get().markDone(pane.id, "idle");
      }
    }, 1000);

    const agents = await detectAgents().catch(() => ({
      claude: null,
      codex: null,
      opencode: null,
    }));
    set({ agents });

    let hookUrl = "";
    try {
      hookUrl = await invoke<string>("hook_url");
      set({ hookUrl });
    } catch {
      // hook server unavailable; idle/bell detection still works
    }
    void invoke("install_hooks").catch(() => {});

    let workspaces: Workspace[] = [];
    let settings = DEFAULT_SETTINGS;
    let savedPanes: SavedPane[] = [];
    try {
      const raw = await invoke<string>("store_load");
      const parsed = JSON.parse(raw) as {
        workspaces?: Workspace[];
        settings?: Partial<Settings>;
        panes?: SavedPane[];
      };
      workspaces = parsed.workspaces ?? [];
      settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
      savedPanes = parsed.panes ?? [];
    } catch {
      workspaces = [];
    }
    set({ settings });

    const wsIds = new Set(workspaces.map((w) => w.id));
    savedPanes = savedPanes.filter((p) => wsIds.has(p.workspaceId));

    if (workspaces.length === 0) {
      const ws: Workspace = {
        id: crypto.randomUUID(),
        title: "My workspace",
        color: DEFAULT_COLOR,
        pinned: false,
        folder: null,
        createdAt: Date.now(),
        layout: null,
      };
      set({ ready: true, workspaces: [ws], activeWorkspaceId: ws.id });
      schedulePersist(get);
      await get().spawnShell(ws.id);
    } else {
      const restored: Pane[] = [];
      for (const sp of savedPanes) {
        if (
          sp.kind === "replay" ||
          sp.kind === "kanban" ||
          sp.kind === "browser" ||
          sp.kind === "editor"
        ) {
          restored.push({
            ...sp,
            ptyId: "",
            status: "running",
            activity: "idle",
            doneSource: null,
          });
          continue;
        }
        const ws = workspaces.find((w) => w.id === sp.workspaceId);
        try {
          const program =
            sp.kind === "agent" && sp.agent
              ? (agents[sp.agent] ?? AGENTS[sp.agent].cmd)
              : undefined;
          const env: Record<string, string> =
            sp.kind === "agent" && sp.agent
              ? {
                  LAYERA_PANE_ID: sp.id,
                  LAYERA_AGENT: sp.agent,
                  LAYERA_HOOK_URL: hookUrl,
                }
              : {};
          const ptyId = await spawnPty({
            cwd: ws?.folder ?? undefined,
            program,
            env,
          });
          restored.push({
            ...sp,
            ptyId,
            status: "running",
            activity: "idle",
            doneSource: null,
          });
          void sessionBegin(ptyId, sp.workspaceId, sp.title).catch(() => {});
        } catch {
          // pane could not be respawned; drop it and prune its layout leaf
        }
      }

      const restoredIds = new Set(restored.map((p) => p.id));
      const fixed = workspaces.map((w) => {
        let layout = w.layout;
        if (layout) {
          for (const leafId of collectLeaves(layout)) {
            if (!restoredIds.has(leafId) && layout) {
              layout = removeLeaf(layout, leafId);
            }
          }
        }
        return { ...w, layout };
      });

      set({
        ready: true,
        workspaces: fixed,
        panes: restored,
        activeWorkspaceId: fixed[0]?.id ?? null,
      });
    }
  },

  createWorkspace: async (title) => {
    const ws: Workspace = {
      id: crypto.randomUUID(),
      title: title || `Workspace ${get().workspaces.length + 1}`,
      color: DEFAULT_COLOR,
      pinned: false,
      folder: null,
      createdAt: Date.now(),
      layout: null,
    };
    set((s) => ({
      workspaces: [...s.workspaces, ws],
      activeWorkspaceId: ws.id,
    }));
    schedulePersist(get);
    await get().spawnShell(ws.id);
    return ws.id;
  },

  updateWorkspace: (id, patch) => {
    set((s) => patchWorkspace(s, id, patch));
    schedulePersist(get);
  },

  deleteWorkspace: (id) => {
    const doomed = get().panes.filter((p) => p.workspaceId === id);
    for (const p of doomed) {
      if (p.ptyId) void killPty(p.ptyId);
      if (p.kind === "browser") {
        void Webview.getByLabel(`browser-${p.id}`).then((w) => w?.close());
      }
    }
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id);
      const panes = s.panes.filter((p) => p.workspaceId !== id);
      return {
        workspaces,
        panes,
        activeWorkspaceId:
          s.activeWorkspaceId === id
            ? (workspaces[0]?.id ?? null)
            : s.activeWorkspaceId,
      };
    });
    schedulePersist(get);
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  spawnShell: async (workspaceId, dir = "h") => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    const ptyId = await spawnPty({ cwd: ws.folder ?? undefined });
    const pane: Pane = {
      id: crypto.randomUUID(),
      ptyId,
      workspaceId,
      kind: "shell",
      title: "shell",
      status: "running",
      activity: "idle",
      doneSource: null,
    };
    void sessionBegin(ptyId, workspaceId, pane.title).catch(() => {});
    addPane(set, get, pane, dir);
    schedulePersist(get);
  },

  spawnAgent: async (workspaceId, kind, dir = "h") => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    const program = get().agents[kind] ?? AGENTS[kind].cmd;
    const paneId = crypto.randomUUID();
    const ptyId = await spawnPty({
      cwd: ws.folder ?? undefined,
      program,
      env: {
        LAYERA_PANE_ID: paneId,
        LAYERA_AGENT: kind,
        LAYERA_HOOK_URL: get().hookUrl,
      },
    });
    const pane: Pane = {
      id: paneId,
      ptyId,
      workspaceId,
      kind: "agent",
      agent: kind,
      title: AGENTS[kind].name,
      status: "running",
      activity: "idle",
      doneSource: null,
    };
    void sessionBegin(ptyId, workspaceId, pane.title).catch(() => {});
    addPane(set, get, pane, dir);
    schedulePersist(get);
  },

  openReplay: (workspaceId, sessionPath, title) => {
    const pane: Pane = {
      id: crypto.randomUUID(),
      ptyId: "",
      workspaceId,
      kind: "replay",
      title,
      status: "running",
      activity: "idle",
      doneSource: null,
      sessionPath,
    };
    addPane(set, get, pane, "h");
    schedulePersist(get);
  },

  openKanban: async (workspaceId) => {
    const existing = get().panes.find(
      (p) => p.workspaceId === workspaceId && p.kind === "kanban",
    );
    if (existing) {
      set((s) => ({ focused: { ...s.focused, [workspaceId]: existing.id } }));
      return;
    }
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    const boardPath = ws.folder
      ? await join(ws.folder, ".layera/tasks/board.json")
      : await invoke<string>("kanban_fallback_path", { workspaceId });
    const pane: Pane = {
      id: crypto.randomUUID(),
      ptyId: "",
      workspaceId,
      kind: "kanban",
      title: "Board",
      status: "running",
      activity: "idle",
      doneSource: null,
      boardPath,
    };
    addPane(set, get, pane, "h");
    schedulePersist(get);
  },

  openBrowser: (workspaceId) => {
    const pane: Pane = {
      id: crypto.randomUUID(),
      ptyId: "",
      workspaceId,
      kind: "browser",
      title: "Browser",
      status: "running",
      activity: "idle",
      doneSource: null,
      url: "",
    };
    addPane(set, get, pane, "h");
    schedulePersist(get);
  },

  openEditor: (workspaceId) => {
    const existing = get().panes.find(
      (p) => p.workspaceId === workspaceId && p.kind === "editor",
    );
    if (existing) {
      set((s) => ({ focused: { ...s.focused, [workspaceId]: existing.id } }));
      return;
    }
    const pane: Pane = {
      id: crypto.randomUUID(),
      ptyId: "",
      workspaceId,
      kind: "editor",
      title: "Editor",
      status: "running",
      activity: "idle",
      doneSource: null,
    };
    addPane(set, get, pane, "h");
    schedulePersist(get);
  },

  updatePane: (paneId, patch) => {
    set((s) => ({
      panes: s.panes.map((p) => (p.id === paneId ? { ...p, ...patch } : p)),
    }));
    schedulePersist(get);
  },

  splitPane: async (paneId, dir) => {
    const pane = get().panes.find((p) => p.id === paneId);
    if (!pane) return;
    set((s) => ({ focused: { ...s.focused, [pane.workspaceId]: paneId } }));
    await get().spawnShell(pane.workspaceId, dir);
  },

  closePane: (paneId) => {
    const pane = get().panes.find((p) => p.id === paneId);
    if (!pane) return;
    if (pane.ptyId) void killPty(pane.ptyId);
    if (pane.kind === "browser") {
      void Webview.getByLabel(`browser-${paneId}`).then((w) => w?.close());
    }
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === pane.workspaceId);
      const layout = ws?.layout ? removeLeaf(ws.layout, paneId) : null;
      const zoomed = { ...s.zoomed };
      if (zoomed[pane.workspaceId] === paneId) zoomed[pane.workspaceId] = null;
      return {
        panes: s.panes.filter((p) => p.id !== paneId),
        zoomed,
        ...patchWorkspace(s, pane.workspaceId, { layout }),
      };
    });
    schedulePersist(get);
  },

  setSplitRatio: (workspaceId, path, ratio) => {
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === workspaceId);
      if (!ws?.layout || ws.layout.type !== "split") return {};
      return patchWorkspace(s, workspaceId, {
        layout: setRatioAt(ws.layout, path, ratio),
      });
    });
    schedulePersist(get);
  },

  toggleZoom: (workspaceId, paneId) => {
    set((s) => ({
      zoomed: {
        ...s.zoomed,
        [workspaceId]: s.zoomed[workspaceId] === paneId ? null : paneId,
      },
    }));
  },

  setFocused: (workspaceId, paneId) => {
    set((s) =>
      s.focused[workspaceId] === paneId
        ? {}
        : { focused: { ...s.focused, [workspaceId]: paneId } },
    );
  },

  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    schedulePersist(get);
  },

  markDone: (paneId, source) => {
    const pane = get().panes.find((p) => p.id === paneId);
    if (!pane || pane.kind !== "agent" || pane.status !== "running") return;
    if (pane.activity === "done") return;
    set((s) => ({
      panes: s.panes.map((p) =>
        p.id === paneId ? { ...p, activity: "done", doneSource: source } : p,
      ),
    }));
    doneHandler?.({ ...pane, activity: "done", doneSource: source }, source);
  },

  reportBell: (ptyId) => {
    const pane = get().panes.find((p) => p.ptyId === ptyId);
    if (
      pane &&
      pane.kind === "agent" &&
      pane.status === "running" &&
      pane.activity === "working"
    ) {
      get().markDone(pane.id, "bell");
    }
  },
}));
