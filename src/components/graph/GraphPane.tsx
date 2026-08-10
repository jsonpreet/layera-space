import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  NODE_HINT,
  NODE_LABEL,
  newNode,
  waveGraph,
  type Graph,
  type GraphNode,
  type NodeStatus,
  type NodeType,
} from "../../lib/graph";
import { validate } from "../../lib/scheduler";
import { useApp, type Pane } from "../../store/app";
import { PALETTE } from "../../lib/theme";
import { Inspector } from "./Inspector";
import { AgentNode } from "./AgentNode";
import { ComparePanel } from "./ComparePanel";

const PALETTE_ORDER: NodeType[] = [
  "prompt",
  "planner",
  "coordinator",
  "builder",
  "verifier",
  "aggregator",
  "shell",
];

const nodeTypes = { agent: AgentNode };

export function GraphPane({ pane }: { pane: Pane }) {
  const workspaceId = pane.workspaceId;
  const graph = useApp((s) => s.graphs[workspaceId]);
  const { loadGraph, saveGraph, startGraphRun, cancelGraphRun } = useApp();
  const graphRun = useApp((s) =>
    Object.values(s.graphRuns)
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => b.startedAt - a.startedAt)[0],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadGraph(workspaceId);
  }, [workspaceId]);

  // Mirror the stored graph into React Flow's own node/edge shape.
  useEffect(() => {
    if (!graph) return;
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "agent",
        position: { x: n.x, y: n.y },
        data: { node: n, status: "pending" as NodeStatus, retries: 0 },
      })),
    );
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        style: { stroke: PALETTE.line, strokeWidth: 1.5 },
      })),
    );
  }, [graph?.id, graph?.nodes.length, graph?.edges.length]);

  // Paint live status onto the nodes without rebuilding them.
  useEffect(() => {
    if (!graphRun) return;
    setNodes((current) =>
      current.map((n) => {
        const state = graphRun.nodeRuns[n.id];
        return state
          ? {
              ...n,
              data: { ...n.data, status: state.status, retries: state.retries },
            }
          : n;
      }),
    );
  }, [graphRun]);

  const persist = useCallback(
    (next: Graph) => {
      void saveGraph(workspaceId, next);
    },
    [workspaceId, saveGraph],
  );

  const syncPositions = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);
      if (!graph) return;
      const moved = changes.filter(
        (c): c is Extract<NodeChange<Node>, { type: "position" }> =>
          c.type === "position" && !c.dragging && !!c.position,
      );
      if (moved.length === 0) return;
      persist({
        ...graph,
        nodes: graph.nodes.map((n) => {
          const change = moved.find((m) => m.id === n.id);
          return change?.position
            ? { ...n, x: change.position.x, y: change.position.y }
            : n;
        }),
      });
    },
    [graph, onNodesChange, persist],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!graph || !connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const exists = graph.edges.some(
        (e) => e.from === connection.source && e.to === connection.target,
      );
      if (exists) return;
      const next: Graph = {
        ...graph,
        edges: [
          ...graph.edges,
          {
            id: crypto.randomUUID(),
            from: connection.source,
            to: connection.target,
          },
        ],
      };
      // Refuse a connection that would make the graph unrunnable.
      const problems = validate(next);
      if (problems.some((p) => /cycle/i.test(p))) {
        setError("That connection would create a loop.");
        return;
      }
      setError(null);
      setEdges((eds) => addEdge({ ...connection, id: crypto.randomUUID() }, eds));
      persist(next);
    },
    [graph, persist, setEdges],
  );

  const addNode = (type: NodeType) => {
    if (!graph) return;
    const node = newNode(type, 80 + graph.nodes.length * 24, 80 + graph.nodes.length * 40);
    persist({ ...graph, nodes: [...graph.nodes, node] });
  };

  const updateNode = (patch: GraphNode) => {
    if (!graph) return;
    persist({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === patch.id ? patch : n)),
    });
  };

  const deleteNode = (id: string) => {
    if (!graph) return;
    persist({
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
    });
    setSelected(null);
  };

  const problems = useMemo(() => (graph ? validate(graph) : []), [graph]);
  const running = graphRun?.status === "running";
  const selectedNode = graph?.nodes.find((n) => n.id === selected) ?? null;

  const start = async () => {
    setError(null);
    try {
      await startGraphRun(workspaceId, input.trim() || "Continue.");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Loading graph…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !running) void start();
          }}
          placeholder="What should this graph do?"
          className="h-6 min-w-0 flex-1 rounded border border-line bg-base px-2 text-[12px] text-ink outline-none placeholder:text-faint focus:border-accent/50"
          spellCheck={false}
        />
        {running ? (
          <button
            type="button"
            onClick={() => void cancelGraphRun(graphRun.id)}
            className="shrink-0 rounded px-2 py-0.5 text-[11px] text-warn transition-colors hover:bg-hover"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={problems.length > 0}
            title={problems.join(" ") || "Run the graph"}
            className="shrink-0 rounded bg-accent-deep px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-accent disabled:bg-raised disabled:text-faint"
          >
            Run
          </button>
        )}
        <button
          type="button"
          onClick={() => persist(waveGraph(3))}
          title="Replace with a coordinator fanning out to three builders"
          className="shrink-0 rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          Wave preset
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2.5 py-1">
        <span className="mr-1 text-[10px] text-faint">Add</span>
        {PALETTE_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addNode(type)}
            title={NODE_HINT[type]}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            {NODE_LABEL[type]}
          </button>
        ))}
      </div>

      {(error || problems.length > 0) && (
        <div className="shrink-0 border-b border-line bg-panel px-2.5 py-1 text-[11px] text-warn">
          {error ?? problems.join(" ")}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={syncPositions}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            style={{ background: PALETTE.base }}
          >
            <Background color={PALETTE.line} gap={22} size={1} />
            <Controls
              showInteractive={false}
              style={{ background: PALETTE.raised, border: "none" }}
            />
          </ReactFlow>
        </div>

        {selectedNode && (
          <Inspector
            node={selectedNode}
            nodeRun={graphRun?.nodeRuns[selectedNode.id]}
            onChange={updateNode}
            onDelete={() => deleteNode(selectedNode.id)}
            onClose={() => setSelected(null)}
          />
        )}

        {selectedNode?.type === "aggregator" && (
          <ComparePanel
            node={selectedNode}
            graph={graph}
            graphRun={graphRun}
            workspaceId={workspaceId}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
