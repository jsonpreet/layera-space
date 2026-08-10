import type { Runner } from "./run";

export type NodeType =
  | "prompt"
  | "planner"
  | "coordinator"
  | "builder"
  | "aggregator"
  | "verifier"
  | "shell";

export type GraphNode = {
  id: string;
  type: NodeType;
  title: string;
  x: number;
  y: number;
  runner?: Runner;
  /** Supports {{input}}, {{parent}}, {{plan}}, {{feedback}}, {{files}}. */
  promptTemplate?: string;
  /** coordinator: how many builders to fan out to. */
  builders?: number;
  /** verifier: shell command to run, or empty for a prompt-based review. */
  command?: string;
  /** verifier: how many times to send failures back to the builders. */
  maxRetries?: number;
  /** builder: run before the agent, e.g. `npm ci` in a fresh worktree. */
  setupCommand?: string;
  /** builder: symlink node_modules/.venv/target in from the main tree. */
  linkDeps?: boolean;
};

export type GraphEdge = { id: string; from: string; to: string };

export type Graph = {
  id: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type NodeStatus =
  | "pending"
  | "running"
  | "ok"
  | "failed"
  | "skipped"
  | "cancelled";

export type NodeRun = {
  nodeId: string;
  runId?: string;
  status: NodeStatus;
  retries: number;
  output?: string;
  error?: string;
  /** builder nodes: the branch and worktree it produced. */
  branch?: string;
  worktree?: string;
  tip?: string;
};

export type GraphRun = {
  id: string;
  graphId: string;
  workspaceId: string;
  input: string;
  status: "running" | "ok" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  nodeRuns: Record<string, NodeRun>;
  baseCommit?: string;
};

export const NODE_LABEL: Record<NodeType, string> = {
  prompt: "Prompt",
  planner: "Planner",
  coordinator: "Coordinator",
  builder: "Builder",
  aggregator: "Aggregator",
  verifier: "Verifier",
  shell: "Shell",
};

export const NODE_HINT: Record<NodeType, string> = {
  prompt: "Passes text straight through to the nodes below.",
  planner: "Turns the task into an ordered plan.",
  coordinator: "Fans one task out to several builders at once.",
  builder: "Implements the task in its own git worktree.",
  aggregator: "Compares the builders' results so you can pick one.",
  verifier: "Checks the result and sends failures back to the builders.",
  shell: "Runs a shell command.",
};

const DEFAULT_TEMPLATE: Partial<Record<NodeType, string>> = {
  planner: "{{input}}",
  builder: "{{plan}}\n\n{{feedback}}",
  verifier: "Review the changes for correctness.\n\n{{files}}",
  aggregator: "{{compare}}\n\nCompare the builders above and recommend one.",
};

export function newNode(type: NodeType, x: number, y: number): GraphNode {
  const base: GraphNode = {
    id: crypto.randomUUID(),
    type,
    title: NODE_LABEL[type],
    x,
    y,
    promptTemplate: DEFAULT_TEMPLATE[type],
  };
  if (type === "coordinator") base.builders = 3;
  if (type === "verifier") {
    base.maxRetries = 1;
    base.command = "";
  }
  if (type === "builder") base.linkDeps = true;
  return base;
}

export function emptyGraph(name = "Graph"): Graph {
  const prompt = newNode("prompt", 60, 40);
  prompt.title = "Task";
  const builder = newNode("builder", 60, 180);
  return {
    id: crypto.randomUUID(),
    name,
    nodes: [prompt, builder],
    edges: [{ id: crypto.randomUUID(), from: prompt.id, to: builder.id }],
  };
}

/** A coordinator fanning out to three builders, verified, then aggregated. */
export function waveGraph(builders = 3): Graph {
  const task = newNode("prompt", 40, 20);
  task.title = "Task";
  const planner = newNode("planner", 40, 140);
  const coordinator = newNode("coordinator", 40, 260);
  coordinator.builders = builders;
  const builderNodes = Array.from({ length: builders }, (_, i) => {
    const n = newNode("builder", 40 + i * 220, 380);
    n.title = `Builder ${i + 1}`;
    return n;
  });
  const verifier = newNode("verifier", 40, 500);
  const aggregator = newNode("aggregator", 40, 620);

  const nodes = [task, planner, coordinator, ...builderNodes, verifier, aggregator];
  const edge = (from: string, to: string): GraphEdge => ({
    id: crypto.randomUUID(),
    from,
    to,
  });
  const edges = [
    edge(task.id, planner.id),
    edge(planner.id, coordinator.id),
    ...builderNodes.map((b) => edge(coordinator.id, b.id)),
    ...builderNodes.map((b) => edge(b.id, verifier.id)),
    edge(verifier.id, aggregator.id),
  ];
  return { id: crypto.randomUUID(), name: "Parallel wave", nodes, edges };
}

export function parentsOf(graph: Graph, nodeId: string): GraphNode[] {
  const ids = graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  return graph.nodes.filter((n) => ids.includes(n.id));
}

export function childrenOf(graph: Graph, nodeId: string): GraphNode[] {
  const ids = graph.edges.filter((e) => e.from === nodeId).map((e) => e.to);
  return graph.nodes.filter((n) => ids.includes(n.id));
}

/**
 * Every node that feeds a node transitively, in dependency order.
 *
 * Unlike `parentsOf` this walks the whole upstream chain — an aggregator's
 * builders are usually two hops up, through the verifier.
 */
export function ancestorsOf(graph: Graph, nodeId: string): GraphNode[] {
  const ids = graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  const seen = new Set<string>();
  const out: GraphNode[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const edge of graph.edges) {
      if (edge.to === id) {
        const parent = graph.nodes.find((n) => n.id === edge.from);
        if (parent) visit(parent.id);
      }
    }
    const node = graph.nodes.find((n) => n.id === id);
    if (node) out.push(node);
  };
  for (const id of ids) visit(id);
  return out;
}

/** The builder nodes whose work reaches an aggregator, in dependency order. */
export function builderAncestors(graph: Graph, nodeId: string): GraphNode[] {
  return ancestorsOf(graph, nodeId).filter((n) => n.type === "builder");
}
