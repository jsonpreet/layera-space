import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { emptyGraph, type Graph, type GraphRun } from "../lib/graph";
import { runGraph, type GraphApi } from "../lib/graphRunner";
import {
  gitRoot,
  gitWaveBase,
  worktreeAdd,
  worktreeCommit,
  worktreeRemove,
  type Runner,
} from "../lib/run";
import { waitForRun } from "../lib/runbus";
import type { AgentKind } from "../lib/agents";
import type { Slice } from "./types";

export type GraphSlice = {
  graphs: Record<string, Graph>;
  graphRuns: Record<string, GraphRun>;
  /** Cancellation flags, keyed by graph run id. */
  graphSignals: Record<string, { cancelled: boolean }>;

  loadGraph: (workspaceId: string) => Promise<Graph>;
  saveGraph: (workspaceId: string, graph: Graph) => Promise<void>;
  setGraph: (graph: Graph) => void;
  startGraphRun: (workspaceId: string, input: string) => Promise<void>;
  cancelGraphRun: (graphRunId: string) => Promise<void>;
};

async function graphPath(
  workspaceId: string,
  folder: string | null,
): Promise<string> {
  return folder
    ? // Inside the project, so a graph is shareable, committable and diffable.
      await join(folder, ".layera", "graphs", "default.json")
    : await invoke<string>("workspace_data_path", {
        workspaceId,
        name: "graph.json",
      });
}

export const createGraphSlice: Slice<GraphSlice> = (set, get) => ({
  graphs: {},
  graphRuns: {},
  graphSignals: {},

  loadGraph: async (workspaceId) => {
    const existing = get().graphs[workspaceId];
    if (existing) return existing;
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    const path = await graphPath(workspaceId, ws?.folder ?? null);
    let graph: Graph;
    try {
      const text = await invoke<string>("fs_read_text", { path });
      graph = JSON.parse(text) as Graph;
      if (!Array.isArray(graph.nodes)) throw new Error("bad graph");
    } catch {
      graph = emptyGraph();
    }
    set((s) => ({ graphs: { ...s.graphs, [workspaceId]: graph } }));
    return graph;
  },

  setGraph: (graph) => {
    set((s) => {
      const entry = Object.entries(s.graphs).find(([, g]) => g.id === graph.id);
      if (!entry) return {};
      return { graphs: { ...s.graphs, [entry[0]]: graph } };
    });
  },

  saveGraph: async (workspaceId, graph) => {
    set((s) => ({ graphs: { ...s.graphs, [workspaceId]: graph } }));
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    const path = await graphPath(workspaceId, ws?.folder ?? null);
    await invoke("fs_write_text", {
      path,
      content: JSON.stringify(graph, null, 2),
    }).catch(() => {});
  },

  startGraphRun: async (workspaceId, input) => {
    const state = get();
    const graph = state.graphs[workspaceId] ?? (await state.loadGraph(workspaceId));
    const ws = state.workspaces.find((w) => w.id === workspaceId);
    if (!ws?.folder) throw new Error("This workspace has no project folder.");
    const cwd = ws.folder;

    const builders = graph.nodes.filter((n) => n.type === "builder").length;
    const root = await gitRoot(cwd).catch(() => null);
    if (builders > 1 && !root) {
      throw new Error(
        "Parallel builders need a git repository — they work in isolated worktrees so they cannot overwrite each other. Initialise one in this folder first.",
      );
    }

    const signal = { cancelled: false };
    const installed = (["claude", "codex", "opencode"] as AgentKind[]).filter(
      (k) =>
        state.agents[k] !== null ||
        !!state.settings.runnerPaths[k],
    ) as Runner[];

    let baseCommit = "";
    const worktrees: string[] = [];

    const api: GraphApi = {
      newId: () => crypto.randomUUID(),
      installedRunners: () => (installed.length > 0 ? installed : ["claude"]),

      startRun: async ({
        runId,
        nodeId,
        prompt,
        runner,
        mode,
        worktree,
        branch,
        write,
      }) => {
        await get().launchRun({
          runId,
          workspaceId,
          runner,
          prompt,
          cwd,
          mode,
          write,
          worktree,
          branch,
          nodeId,
          graphRunId: runId,
          label: graph.nodes.find((n) => n.id === nodeId)?.title,
          captureDiff: true,
          runnerPaths: state.settings.runnerPaths,
        });
      },

      awaitRun: async (runId) => {
        const { record } = await waitForRun(runId);
        return {
          status: record.status,
          summary: record.summary,
          filesChanged: record.filesChanged,
        };
      },

      cancelRun: async (runId) => {
        await get().stopRun(runId);
      },

      ...(root
        ? {
            worktree: {
              base: async () => {
                const indexPath = await invoke<string>("workspace_data_path", {
                  workspaceId,
                  name: "wave.index",
                });
                baseCommit = await gitWaveBase(root, indexPath);
                return baseCommit;
              },
              add: async (nodeId, base) => {
                const short = nodeId.slice(0, 8);
                const path = await invoke<string>("workspace_data_path", {
                  workspaceId,
                  name: `wt-${short}`,
                });
                const branch = `layera/${short}`;
                await worktreeAdd(root, path, branch, base);
                worktrees.push(path);
                return { path, branch };
              },
              commit: (path, message) => worktreeCommit(path, message),
              remove: (path) => worktreeRemove(root, path),
            },
          }
        : {}),
    };

    const onUpdate = (run: GraphRun) => {
      set((s) => ({
        graphRuns: { ...s.graphRuns, [run.id]: run },
        graphSignals: { ...s.graphSignals, [run.id]: signal },
      }));
    };

    try {
      const run = await runGraph({
        graph,
        input,
        workspaceId,
        cwd,
        api,
        defaultRunner: state.settings.railRunner,
        onUpdate,
        signal,
      });
      onUpdate(run);
    } finally {
      // Worktrees are disposable; the branches they produced are not, so those
      // stay until the user removes them.
      if (root) {
        for (const path of worktrees) {
          await worktreeRemove(root, path).catch(() => {});
        }
      }
    }
  },

  cancelGraphRun: async (graphRunId) => {
    const signal = get().graphSignals[graphRunId];
    if (signal) signal.cancelled = true;
    const run = get().graphRuns[graphRunId];
    if (!run) return;
    for (const nodeRun of Object.values(run.nodeRuns)) {
      if (nodeRun.status === "running" && nodeRun.runId) {
        await get().stopRun(nodeRun.runId);
      }
    }
  },
});
