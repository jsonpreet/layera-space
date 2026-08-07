import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Webview } from "@tauri-apps/api/webview";
import { AGENTS } from "../lib/agents";
import { publishPtyOutput, tapPtyOutput } from "../lib/bus";
import {
  detectAgents,
  killPty,
  spawnPty,
  type PtyExit,
  type PtyOutput,
} from "../lib/pty";
import { collectLeaves, removeLeaf } from "../lib/layout";
import { clearRecordingMarks } from "./panes";
import { loadStore, patchWorkspace, schedulePersist } from "./persist";
import {
  DEFAULT_COLOR,
  DEFAULT_SETTINGS,
  type Pane,
  type Slice,
  type Workspace,
  type WorkspaceSlice,
} from "./types";

type HookPayload = { pane_id: string; agent: string; event: string };

const lastOut = new Map<string, number>();
let idleTimer: ReturnType<typeof setInterval> | undefined;

/** Pane kinds that own no pty and therefore need nothing respawned. */
const SURFACE_KINDS = new Set<Pane["kind"]>([
  "replay",
  "kanban",
  "browser",
  "editor",
  "diff",
  "graph",
  "memory",
]);

function newWorkspace(title: string): Workspace {
  return {
    id: crypto.randomUUID(),
    title,
    color: DEFAULT_COLOR,
    pinned: false,
    folder: null,
    createdAt: Date.now(),
    layout: null,
  };
}

export const createWorkspaceSlice: Slice<WorkspaceSlice> = (set, get) => ({
  ready: false,
  workspaces: [],
  activeWorkspaceId: null,
  agents: { claude: null, codex: null, opencode: null },
  hookUrl: "",
  settings: DEFAULT_SETTINGS,

  init: async () => {
    if (get().ready) return;
    clearRecordingMarks();

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
      const idleMs = get().settings.idleMs;
      for (const pane of get().panes) {
        if (
          pane.kind !== "agent" ||
          pane.status !== "running" ||
          pane.activity !== "working"
        )
          continue;
        const t = lastOut.get(pane.ptyId) ?? 0;
        if (t > 0 && now - t > idleMs) get().markDone(pane.id, "idle");
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
      // Hook server unavailable; bell and idle detection still work.
    }
    void invoke("install_hooks").catch(() => {});

    const { workspaces, settings, panes: savedPanes } = await loadStore();
    set({ settings });

    if (workspaces.length === 0) {
      const ws = newWorkspace("My workspace");
      set({ ready: true, workspaces: [ws], activeWorkspaceId: ws.id });
      schedulePersist(get);
      await get().spawnShell(ws.id);
      return;
    }

    const restored: Pane[] = [];
    for (const sp of savedPanes) {
      if (SURFACE_KINDS.has(sp.kind)) {
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
          // A restored pane records afresh; the terminal starts it once fitted.
          sessionPath: undefined,
        });
      } catch {
        // Pane could not be respawned; drop it and prune its layout leaf below.
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

    // Runs left "running" on disk had no process behind them once the app
    // closed; mark them honestly, then trim old transcripts.
    const { reconcileRuns, runsGc } = await import("../lib/run");
    for (const ws of fixed) {
      void reconcileRuns(ws.id)
        .then(() => runsGc(ws.id))
        .then(() => get().refreshRunHistory(ws.id))
        .catch(() => {});
    }
  },

  createWorkspace: async (title) => {
    const ws = newWorkspace(title || `Workspace ${get().workspaces.length + 1}`);
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
    for (const p of get().panes.filter((p) => p.workspaceId === id)) {
      if (p.ptyId) void killPty(p.ptyId);
      if (p.kind === "browser") {
        void Webview.getByLabel(`browser-${p.id}`).then((w) => w?.close());
      }
    }
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id);
      return {
        workspaces,
        panes: s.panes.filter((p) => p.workspaceId !== id),
        activeWorkspaceId:
          s.activeWorkspaceId === id
            ? (workspaces[0]?.id ?? null)
            : s.activeWorkspaceId,
      };
    });
    schedulePersist(get);
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    schedulePersist(get);
  },
});
