import type { Graph, GraphNode } from "./graph";

/**
 * Group nodes into waves of independent work.
 *
 * Every node in a wave has all of its parents in earlier waves, so a wave can
 * run fully in parallel. Throws on a cycle rather than looping forever.
 */
export function topoOrder(graph: Graph): GraphNode[][] {
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    children.set(node.id, []);
  }
  for (const edge of graph.edges) {
    // Ignore edges pointing at nodes that no longer exist.
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    children.get(edge.from)!.push(edge.to);
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const waves: GraphNode[][] = [];
  let frontier = graph.nodes.filter((n) => indegree.get(n.id) === 0);
  let placed = 0;

  while (frontier.length > 0) {
    waves.push(frontier);
    placed += frontier.length;
    const next: GraphNode[] = [];
    for (const node of frontier) {
      for (const childId of children.get(node.id) ?? []) {
        const remaining = (indegree.get(childId) ?? 0) - 1;
        indegree.set(childId, remaining);
        if (remaining === 0) {
          const child = byId.get(childId);
          if (child) next.push(child);
        }
      }
    }
    frontier = next;
  }

  if (placed !== graph.nodes.length) {
    throw new Error("This graph has a cycle — nodes must flow one way.");
  }
  return waves;
}

/** Problems worth blocking a run for, phrased for a person. */
export function validate(graph: Graph): string[] {
  const problems: string[] = [];

  if (graph.nodes.length === 0) {
    problems.push("The graph is empty.");
    return problems;
  }

  try {
    topoOrder(graph);
  } catch (error) {
    problems.push(String(error instanceof Error ? error.message : error));
  }

  const hasParent = new Set(graph.edges.map((e) => e.to));
  const roots = graph.nodes.filter((n) => !hasParent.has(n.id));
  if (roots.length === 0 && graph.nodes.length > 0) {
    problems.push("Every node has an input, so nothing can start.");
  }

  for (const node of graph.nodes) {
    if (node.type === "aggregator") {
      const parents = graph.edges.filter((e) => e.to === node.id);
      if (parents.length === 0) {
        problems.push(`"${node.title}" has nothing to aggregate.`);
      }
    }
    if (node.type === "coordinator" && (node.builders ?? 0) < 1) {
      problems.push(`"${node.title}" is set to fan out to no builders.`);
    }
  }

  return problems;
}

export type TemplateVars = {
  input?: string;
  parent?: string;
  plan?: string;
  feedback?: string;
  files?: string;
};

/**
 * Fill a node's prompt template.
 *
 * An unknown placeholder is left alone rather than blanked, so a typo shows up
 * in the prompt instead of silently deleting a line of instruction.
 */
export function renderTemplate(
  template: string | undefined,
  vars: TemplateVars,
): string {
  const source = template?.trim() ? template : "{{input}}";
  return source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key as keyof TemplateVars];
    return value === undefined ? match : value;
  });
}

/** Nodes that can never be reached from a root, given the edges present. */
export function unreachable(graph: Graph): GraphNode[] {
  const hasParent = new Set(graph.edges.map((e) => e.to));
  const roots = graph.nodes.filter((n) => !hasParent.has(n.id));
  const seen = new Set(roots.map((n) => n.id));
  const queue = [...roots.map((n) => n.id)];

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of graph.edges.filter((e) => e.from === id)) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return graph.nodes.filter((n) => !seen.has(n.id));
}
