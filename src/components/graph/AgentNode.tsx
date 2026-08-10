import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_LABEL, type GraphNode, type NodeStatus } from "../../lib/graph";
import { RUNNER_LABEL } from "../../lib/run";
import { PALETTE } from "../../lib/theme";

/**
 * Node marks drawn for this app rather than taken from an icon set.
 *
 * One invented rule holds the set together: every mark is read top to bottom as
 * flow passing through the node, matching the direction edges actually run in
 * the graph. Work enters at the top, something happens to it in the middle, and
 * it leaves at the bottom. That is what makes them belong here rather than
 * being generic glyphs — a house or a tick would sit on any product unchanged.
 */
function NodeMark({ type }: { type: GraphNode["type"] }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    // A source: nothing enters, lines of text leave.
    case "prompt":
      return (
        <svg {...common}>
          <path d="M3 4h8M3 7h6M3 10h3" />
          <path d="M7 10v2" />
        </svg>
      );
    // One input, ordered steps out.
    case "planner":
      return (
        <svg {...common}>
          <path d="M7 2v2" />
          <path d="M4 4v7" />
          <path d="M4 5.5h6M4 8h6M4 10.5h4" />
        </svg>
      );
    // One input fanning into several parallel paths.
    case "coordinator":
      return (
        <svg {...common}>
          <path d="M7 2v3" />
          <path d="M2 8v4M7 8v4M12 8v4" />
          <path d="M2 8h10" />
          <path d="M7 5v3" />
        </svg>
      );
    // Flow entering, and material taking shape from it.
    case "builder":
      return (
        <svg {...common}>
          <path d="M7 2v2.5" />
          <rect x="3.5" y="4.5" width="7" height="5" rx="1" />
          <path d="M7 9.5V12" />
        </svg>
      );
    // Several paths merging back into one.
    case "aggregator":
      return (
        <svg {...common}>
          <path d="M2 2v4M7 2v4M12 2v4" />
          <path d="M2 6h10" />
          <path d="M7 6v6" />
        </svg>
      );
    // Flow squeezed through a gate: only what passes continues.
    case "verifier":
      return (
        <svg {...common}>
          <path d="M7 2v3" />
          <path d="M3 5l4 3 4-3" />
          <path d="M7 8v4" />
        </svg>
      );
    // A command prompt: the caret, and the line it runs.
    case "shell":
      return (
        <svg {...common}>
          <path d="M7 2v2" />
          <path d="M3.5 5.5 6 8l-2.5 2.5" />
          <path d="M7.5 10.5h3" />
        </svg>
      );
  }
}

const STATUS_TONE: Record<NodeStatus, string> = {
  pending: PALETTE.line,
  running: PALETTE.warn,
  ok: PALETTE.ok,
  failed: PALETTE.danger,
  skipped: PALETTE.faint,
  cancelled: PALETTE.faint,
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "",
  running: "running",
  ok: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "stopped",
};

type Data = { node: GraphNode; status: NodeStatus; retries: number };

export function AgentNode({ data, selected }: NodeProps) {
  const { node, status, retries } = data as unknown as Data;
  const tone = STATUS_TONE[status];
  const label = STATUS_LABEL[status];

  return (
    <div
      className="min-w-[168px] rounded bg-panel"
      style={{
        // The border carries the state: no glow, no fill change, no lift.
        border: `1px solid ${status === "pending" && !selected ? PALETTE.line : tone}`,
        boxShadow: selected ? `0 0 0 1px ${PALETTE.accent}` : "none",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: PALETTE.faint, width: 6, height: 6, border: "none" }}
      />

      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="shrink-0 text-muted">
          <NodeMark type={node.type} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
          {node.title}
        </span>
        {status === "running" && (
          <span
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
            style={{ background: tone }}
          />
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-1 text-[10px] text-faint">
        <span>{NODE_LABEL[node.type]}</span>
        {node.runner && <span>· {RUNNER_LABEL[node.runner]}</span>}
        {node.type === "coordinator" && node.builders != null && (
          <span>· ×{node.builders}</span>
        )}
        {retries > 0 && <span className="text-warn">· retry {retries}</span>}
        {label && (
          <span className="ml-auto" style={{ color: tone }}>
            {label}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: PALETTE.faint, width: 6, height: 6, border: "none" }}
      />
    </div>
  );
}
