import { describe, expect, it, vi } from "vitest";
import {
  builderAncestors,
  emptyGraph,
  newNode,
  waveGraph,
  type Graph,
  type GraphEdge,
} from "../graph";
import { renderTemplate, topoOrder, unreachable, validate } from "../scheduler";
import { readVerdict, runGraph, type GraphApi } from "../graphRunner";
import type { FileChange } from "../run";

function edge(from: string, to: string): GraphEdge {
  return { id: `${from}->${to}`, from, to };
}

function graphOf(nodes: ReturnType<typeof newNode>[], edges: GraphEdge[]): Graph {
  return { id: "g", name: "g", nodes, edges };
}

describe("topoOrder", () => {
  it("groups independent nodes into one wave", () => {
    const a = newNode("prompt", 0, 0);
    const b = newNode("builder", 0, 0);
    const c = newNode("builder", 0, 0);
    const d = newNode("aggregator", 0, 0);
    const waves = topoOrder(
      graphOf([a, b, c, d], [edge(a.id, b.id), edge(a.id, c.id), edge(b.id, d.id), edge(c.id, d.id)]),
    );
    expect(waves.map((w) => w.length)).toEqual([1, 2, 1]);
    expect(waves[1].map((n) => n.id).sort()).toEqual([b.id, c.id].sort());
  });

  it("throws on a cycle instead of hanging", () => {
    const a = newNode("builder", 0, 0);
    const b = newNode("builder", 0, 0);
    expect(() =>
      topoOrder(graphOf([a, b], [edge(a.id, b.id), edge(b.id, a.id)])),
    ).toThrow(/cycle/i);
  });

  it("ignores edges pointing at deleted nodes", () => {
    const a = newNode("prompt", 0, 0);
    const waves = topoOrder(graphOf([a], [edge(a.id, "ghost")]));
    expect(waves).toEqual([[a]]);
  });

  it("orders the built-in wave graph sensibly", () => {
    const waves = topoOrder(waveGraph(3));
    // task, planner, coordinator, 3 builders, verifier, aggregator
    expect(waves.map((w) => w.length)).toEqual([1, 1, 1, 3, 1, 1]);
  });
});

describe("validate", () => {
  it("accepts the starter graphs", () => {
    expect(validate(emptyGraph())).toEqual([]);
    expect(validate(waveGraph(3))).toEqual([]);
  });

  it("reports an empty graph", () => {
    expect(validate({ id: "g", name: "g", nodes: [], edges: [] })).toHaveLength(1);
  });

  it("reports a cycle, and that nothing can start", () => {
    const a = newNode("builder", 0, 0);
    const b = newNode("builder", 0, 0);
    const problems = validate(graphOf([a, b], [edge(a.id, b.id), edge(b.id, a.id)]));
    expect(problems.join(" ")).toMatch(/cycle/i);
    expect(problems.join(" ")).toMatch(/nothing can start/i);
  });

  it("reports an aggregator with no inputs", () => {
    const a = newNode("prompt", 0, 0);
    const agg = newNode("aggregator", 0, 0);
    expect(validate(graphOf([a, agg], [])).join(" ")).toMatch(/nothing to aggregate/i);
  });

  it("reports a coordinator fanning out to nobody", () => {
    const a = newNode("prompt", 0, 0);
    const c = newNode("coordinator", 0, 0);
    c.builders = 0;
    expect(validate(graphOf([a, c], [edge(a.id, c.id)])).join(" ")).toMatch(/no builders/i);
  });
});

describe("unreachable", () => {
  it("finds nodes no root can reach", () => {
    const a = newNode("prompt", 0, 0);
    const b = newNode("builder", 0, 0);
    const island1 = newNode("builder", 0, 0);
    const island2 = newNode("builder", 0, 0);
    const found = unreachable(
      graphOf(
        [a, b, island1, island2],
        [edge(a.id, b.id), edge(island1.id, island2.id), edge(island2.id, island1.id)],
      ),
    );
    expect(found.map((n) => n.id).sort()).toEqual([island1.id, island2.id].sort());
  });
});

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    expect(renderTemplate("do {{input}} now", { input: "this" })).toBe("do this now");
  });

  it("leaves an unknown placeholder visible rather than blanking the line", () => {
    expect(renderTemplate("a {{nope}} b", { input: "x" })).toBe("a {{nope}} b");
  });

  it("falls back to the raw input when there is no template", () => {
    expect(renderTemplate(undefined, { input: "task" })).toBe("task");
    expect(renderTemplate("   ", { input: "task" })).toBe("task");
  });

  it("substitutes an empty string for a known-but-empty variable", () => {
    expect(renderTemplate("[{{feedback}}]", { feedback: "" })).toBe("[]");
  });

  it("fills the compare placeholder for aggregator nodes", () => {
    expect(renderTemplate("{{compare}}", { compare: "## Builder 1" })).toBe(
      "## Builder 1",
    );
  });
});

describe("builderAncestors", () => {
  it("finds builders two hops up through a verifier", () => {
    const graph = waveGraph(3);
    const aggregator = graph.nodes.find((n) => n.type === "aggregator")!;
    const builders = builderAncestors(graph, aggregator.id);
    expect(builders).toHaveLength(3);
    expect(builders.every((b) => b.type === "builder")).toBe(true);
  });

  it("excludes non-builder ancestors like the planner", () => {
    const graph = waveGraph(2);
    const aggregator = graph.nodes.find((n) => n.type === "aggregator")!;
    const ids = builderAncestors(graph, aggregator.id).map((b) => b.id);
    const planner = graph.nodes.find((n) => n.type === "planner")!;
    expect(ids).not.toContain(planner.id);
  });

  it("returns nothing for a node with no upstream builders", () => {
    const a = newNode("prompt", 0, 0);
    const b = newNode("builder", 0, 0);
    expect(builderAncestors(graphOf([a, b], [edge(a.id, b.id)]), a.id)).toHaveLength(0);
  });
});

describe("readVerdict", () => {
  const shell = { ...newNode("verifier", 0, 0), command: "npm test" };
  const prompt = newNode("verifier", 0, 0);

  it("uses the exit code for a shell verifier", () => {
    expect(readVerdict(shell, { status: "ok" })).toBe(true);
    expect(readVerdict(shell, { status: "error" })).toBe(false);
  });

  it("reads an explicit verdict from a prompt verifier", () => {
    expect(readVerdict(prompt, { status: "ok", summary: "VERDICT: PASS" })).toBe(true);
    expect(readVerdict(prompt, { status: "ok", summary: "VERDICT: FAIL" })).toBe(false);
  });

  it("treats talk of failure as a failure", () => {
    expect(readVerdict(prompt, { status: "ok", summary: "the tests failed" })).toBe(false);
  });

  it("does not read 'no failures' as a failure", () => {
    expect(readVerdict(prompt, { status: "ok", summary: "no failures found" })).toBe(true);
  });
});

// ------------------------------------------------------------ graph runner

type Scripted = Record<string, { status?: string; summary?: string; files?: FileChange[] }>;

/** A fake API so the whole execution path runs with no Tauri and no processes. */
function fakeApi(script: Scripted = {}, order: string[] = []): GraphApi {
  let n = 0;
  const runToNode = new Map<string, string>();
  return {
    newId: () => `id-${++n}`,
    installedRunners: () => ["claude", "codex", "opencode"],
    startRun: vi.fn(async ({ runId, nodeId }) => {
      runToNode.set(runId, nodeId);
      order.push(nodeId);
    }),
    awaitRun: vi.fn(async (runId) => {
      const nodeId = runToNode.get(runId)!;
      const scripted = script[nodeId] ?? {};
      return {
        status: scripted.status ?? "ok",
        summary: scripted.summary ?? `output of ${nodeId}`,
        filesChanged: scripted.files ?? [],
      };
    }),
    cancelRun: vi.fn(async () => {}),
  };
}

describe("runGraph", () => {
  it("runs a simple graph to completion", async () => {
    const graph = emptyGraph();
    const run = await runGraph({
      graph,
      input: "do the thing",
      workspaceId: "w",
      cwd: "/tmp",
      api: fakeApi(),
      defaultRunner: "claude",
    });
    expect(run.status).toBe("ok");
    expect(Object.values(run.nodeRuns).every((n) => n.status === "ok")).toBe(true);
  });

  it("passes the task through a prompt node without spawning a run", async () => {
    const api = fakeApi();
    const graph = emptyGraph();
    await runGraph({
      graph,
      input: "task text",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
    });
    // Only the builder spawns; the prompt node is wiring.
    expect(api.startRun).toHaveBeenCalledTimes(1);
  });

  it("marks the graph failed when a node fails", async () => {
    const graph = emptyGraph();
    const builder = graph.nodes.find((n) => n.type === "builder")!;
    const run = await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api: fakeApi({ [builder.id]: { status: "error" } }),
      defaultRunner: "claude",
    });
    expect(run.status).toBe("failed");
    expect(run.nodeRuns[builder.id].status).toBe("failed");
  });

  it("spreads builders across the installed runners", async () => {
    const graph = waveGraph(3);
    const api = fakeApi();
    await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
    });
    const builders = graph.nodes.filter((n) => n.type === "builder");
    expect(builders.map((b) => b.runner)).toEqual(["claude", "codex", "opencode"]);
  });

  it("retries the builders when the verifier fails, up to maxRetries", async () => {
    const graph = waveGraph(2);
    const verifier = graph.nodes.find((n) => n.type === "verifier")!;
    verifier.maxRetries = 2;
    const order: string[] = [];
    const api = fakeApi(
      { [verifier.id]: { status: "ok", summary: "VERDICT: FAIL" } },
      order,
    );

    const run = await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
    });

    // Initial verify + 2 retries = 3 verifier runs.
    expect(order.filter((id) => id === verifier.id)).toHaveLength(3);
    expect(run.nodeRuns[verifier.id].retries).toBe(2);
    // Each builder ran once up front and once per retry.
    const builders = graph.nodes.filter((n) => n.type === "builder");
    for (const b of builders) {
      expect(order.filter((id) => id === b.id)).toHaveLength(3);
    }
  });

  it("stops retrying as soon as the verifier passes", async () => {
    const graph = waveGraph(2);
    const verifier = graph.nodes.find((n) => n.type === "verifier")!;
    verifier.maxRetries = 3;
    const order: string[] = [];
    await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api: fakeApi({ [verifier.id]: { summary: "VERDICT: PASS" } }, order),
      defaultRunner: "claude",
    });
    expect(order.filter((id) => id === verifier.id)).toHaveLength(1);
  });

  it("feeds the aggregator each builder's branch and summary", async () => {
    const graph = waveGraph(2);
    const aggregator = graph.nodes.find((n) => n.type === "aggregator")!;
    const api = fakeApi();
    await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
    });
    const call = (api.startRun as ReturnType<typeof vi.fn>).mock.calls.find(
      ([opts]) => opts.nodeId === aggregator.id,
    )?.[0] as { prompt: string };
    expect(call.prompt).toContain("## Builder 1");
    expect(call.prompt).toContain("## Builder 2");
    expect(call.prompt).toMatch(/output of/);
  });

  it("creates one worktree per builder and commits each", async () => {
    const graph = waveGraph(3);
    const added: string[] = [];
    const committed: string[] = [];
    const api: GraphApi = {
      ...fakeApi(),
      worktree: {
        base: async () => "base-sha",
        add: async (nodeId) => {
          added.push(nodeId);
          return { path: `/wt/${nodeId}`, branch: `layera/${nodeId}` };
        },
        commit: async (path) => {
          committed.push(path);
          return `tip-${path}`;
        },
        remove: async () => {},
      },
    };

    const run = await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
    });

    expect(added).toHaveLength(3);
    expect(committed).toHaveLength(3);
    expect(run.baseCommit).toBe("base-sha");
    const builders = graph.nodes.filter((n) => n.type === "builder");
    for (const b of builders) {
      expect(run.nodeRuns[b.id].worktree).toBe(`/wt/${b.id}`);
      expect(run.nodeRuns[b.id].tip).toBe(`tip-/wt/${b.id}`);
    }
  });

  it("runs a builder's setup command before the agent", async () => {
    const graph = waveGraph(2);
    for (const node of graph.nodes.filter((n) => n.type === "builder")) {
      node.setupCommand = "npm ci";
    }
    const setups: string[] = [];
    const api: GraphApi = {
      ...fakeApi(),
      worktree: {
        base: async () => "base",
        add: async (nodeId) => ({ path: `/wt/${nodeId}`, branch: "b" }),
        commit: async () => "tip",
        remove: async () => {},
      },
      runSetup: async (cwd, command) => {
        setups.push(`${cwd}:${command}`);
      },
    };
    await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
    });
    expect(setups).toHaveLength(2);
    expect(setups[0]).toContain("npm ci");
  });

  it("refuses to run an invalid graph", async () => {
    const a = newNode("builder", 0, 0);
    const b = newNode("builder", 0, 0);
    await expect(
      runGraph({
        graph: graphOf([a, b], [edge(a.id, b.id), edge(b.id, a.id)]),
        input: "x",
        workspaceId: "w",
        cwd: "/tmp",
        api: fakeApi(),
        defaultRunner: "claude",
      }),
    ).rejects.toThrow(/cycle/i);
  });

  it("stops early when cancelled", async () => {
    const graph = waveGraph(3);
    const signal = { cancelled: false };
    const order: string[] = [];
    const api = fakeApi({}, order);
    // Cancel as soon as the first run is dispatched.
    const originalStart = api.startRun;
    api.startRun = async (opts) => {
      signal.cancelled = true;
      return originalStart(opts);
    };

    const run = await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api,
      defaultRunner: "claude",
      signal,
    });
    expect(run.status).toBe("cancelled");
    expect(order.length).toBeLessThan(graph.nodes.length);
  });

  it("reports progress as nodes change state", async () => {
    const updates: string[] = [];
    const graph = emptyGraph();
    await runGraph({
      graph,
      input: "x",
      workspaceId: "w",
      cwd: "/tmp",
      api: fakeApi(),
      defaultRunner: "claude",
      onUpdate: (run) => {
        updates.push(
          Object.values(run.nodeRuns)
            .map((n) => n.status)
            .join(","),
        );
      },
    });
    expect(updates.length).toBeGreaterThan(2);
    expect(updates[updates.length - 1]).not.toContain("pending");
  });
});
