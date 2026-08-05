import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { Webview } from "@tauri-apps/api/webview";
import { AGENTS, type AgentKind } from "../lib/agents";
import { firstLeaf, insertSplit, removeLeaf, setRatioAt } from "../lib/layout";
import { killPty, spawnPty } from "../lib/pty";
import { sessionBegin } from "../lib/session";
import { patchWorkspace, schedulePersist } from "./persist";
import type {
  DoneSource,
  GetState,
  Pane,
  PaneSlice,
  SetState,
  Slice,
} from "./types";

let doneHandler: ((pane: Pane, source: DoneSource) => void) | null = null;

export function setDoneHandler(
  fn: ((pane: Pane, source: DoneSource) => void) | null,
) {
  doneHandler = fn;
}

/** Panes that have already had a cast recording started, keyed by pane id. */
const recording = new Set<string>();

export function clearRecordingMarks() {
  recording.clear();
}

function addPane(set: SetState, get: GetState, pane: Pane, dir: "h" | "v") {
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

/** A non-terminal pane: no pty, no recording, just a surface in the layout. */
function surfacePane(
  workspaceId: string,
  kind: Pane["kind"],
  title: string,
  extra: Partial<Pane> = {},
): Pane {
  return {
    id: crypto.randomUUID(),
    ptyId: "",
    workspaceId,
    kind,
    title,
    status: "running",
    activity: "idle",
    doneSource: null,
    ...extra,
  };
}

/**
 * Kanban, editor, graph and memory are one-per-workspace: opening them again
 * focuses the pane that already exists rather than stacking duplicates.
 */
function focusExisting(
  set: SetState,
  get: GetState,
  workspaceId: string,
  kind: Pane["kind"],
): boolean {
  const existing = get().panes.find(
    (p) => p.workspaceId === workspaceId && p.kind === kind,
  );
  if (!existing) return false;
  set((s) => ({ focused: { ...s.focused, [workspaceId]: existing.id } }));
  return true;
}

export const createPaneSlice: Slice<PaneSlice> = (set, get) => ({
  panes: [],
  focused: {},
  zoomed: {},
  overlayCount: 0,

  pushOverlay: () => set((s) => ({ overlayCount: s.overlayCount + 1 })),
  popOverlay: () =>
    set((s) => ({ overlayCount: Math.max(0, s.overlayCount - 1) })),

  spawnShell: async (workspaceId, dir = "h") => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    const ptyId = await spawnPty({ cwd: ws.folder ?? undefined });
    addPane(
      set,
      get,
      {
        id: crypto.randomUUID(),
        ptyId,
        workspaceId,
        kind: "shell",
        title: "shell",
        status: "running",
        activity: "idle",
        doneSource: null,
      },
      dir,
    );
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
    addPane(
      set,
      get,
      {
        id: paneId,
        ptyId,
        workspaceId,
        kind: "agent",
        agent: kind,
        title: AGENTS[kind].name,
        status: "running",
        activity: "idle",
        doneSource: null,
      },
      dir,
    );
    schedulePersist(get);
  },

  beginRecording: (paneId, cols, rows) => {
    if (recording.has(paneId)) return;
    const pane = get().panes.find((p) => p.id === paneId);
    if (!pane?.ptyId) return;
    recording.add(paneId);
    void sessionBegin(pane.ptyId, pane.workspaceId, pane.title, rows, cols)
      .then((path) => get().updatePane(paneId, { sessionPath: path }))
      .catch(() => recording.delete(paneId));
  },

  openReplay: (workspaceId, sessionPath, title) => {
    addPane(
      set,
      get,
      surfacePane(workspaceId, "replay", title, { sessionPath }),
      "h",
    );
    schedulePersist(get);
  },

  openKanban: async (workspaceId) => {
    if (focusExisting(set, get, workspaceId, "kanban")) return;
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    // Stage 3 moves this to `.layera/tasks/board.md` with a migration; until the
    // Markdown parser lands the pane still reads and writes the JSON board.
    const boardPath = ws.folder
      ? await join(ws.folder, ".layera/tasks/board.json")
      : await invoke<string>("kanban_fallback_path", { workspaceId });
    addPane(
      set,
      get,
      surfacePane(workspaceId, "kanban", "Board", { boardPath }),
      "h",
    );
    schedulePersist(get);
  },

  openBrowser: (workspaceId) => {
    addPane(
      set,
      get,
      surfacePane(workspaceId, "browser", "Browser", { url: "" }),
      "h",
    );
    schedulePersist(get);
  },

  openEditor: (workspaceId) => {
    if (focusExisting(set, get, workspaceId, "editor")) return;
    addPane(set, get, surfacePane(workspaceId, "editor", "Editor"), "h");
    schedulePersist(get);
  },

  openDiff: (workspaceId, runId, title) => {
    const existing = get().panes.find(
      (p) => p.workspaceId === workspaceId && p.kind === "diff" && p.runId === runId,
    );
    if (existing) {
      set((s) => ({ focused: { ...s.focused, [workspaceId]: existing.id } }));
      return;
    }
    addPane(set, get, surfacePane(workspaceId, "diff", title, { runId }), "h");
    schedulePersist(get);
  },

  openGraph: async (workspaceId) => {
    if (focusExisting(set, get, workspaceId, "graph")) return;
    addPane(set, get, surfacePane(workspaceId, "graph", "Graph"), "h");
    schedulePersist(get);
  },

  openMemory: async (workspaceId) => {
    if (focusExisting(set, get, workspaceId, "memory")) return;
    addPane(set, get, surfacePane(workspaceId, "memory", "Memory"), "h");
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
    recording.delete(paneId);
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
});

export { addPane, surfacePane };
export type { AgentKind };
