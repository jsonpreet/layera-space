import { useRef } from "react";
import type { LayoutNode } from "../lib/layout";
import { collectLeaves, filterLayout } from "../lib/layout";
import type { Pane } from "../store/app";
import { LayoutView } from "./LayoutView";
import { PaneFrame } from "./PaneFrame";

const DEFAULT_DOCK_RATIO = 0.3;

function isTerminal(pane: Pane): boolean {
  return pane.kind === "shell" || pane.kind === "agent";
}

export function DockLayoutView({
  wsId,
  node,
  panes,
  ratio = DEFAULT_DOCK_RATIO,
  onRatioChange,
}: {
  wsId: string;
  node: LayoutNode;
  panes: Pane[];
  ratio?: number;
  onRatioChange: (ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminals = panes.filter(isTerminal);
  const terminalIds = new Set(terminals.map((pane) => pane.id));
  const contentLayout = filterLayout(
    node,
    new Set(panes.filter((pane) => !terminalIds.has(pane.id)).map((pane) => pane.id)),
  );

  if (!contentLayout || terminals.length === 0) {
    return <LayoutView wsId={wsId} node={node} path={[]} />;
  }

  const orderedTerminals = collectLeaves(node)
    .map((paneId) => panes.find((pane) => pane.id === paneId))
    .filter((pane): pane is Pane => pane !== undefined && isTerminal(pane));

  const startDrag = (event: React.MouseEvent) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const move = (current: MouseEvent) => {
      const dockRatio = 1 - (current.clientY - rect.top) / rect.height;
      onRatioChange(Math.min(0.65, Math.max(0.18, dockRatio)));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 min-w-0 flex-1">
        <LayoutView wsId={wsId} node={contentLayout} path={[]} />
      </div>
      <div
        onMouseDown={startDrag}
        className="h-1 shrink-0 cursor-row-resize bg-line transition-colors hover:bg-accent/60"
        title="Resize terminal dock"
      />
      <div
        style={{ flexBasis: `${Math.min(0.65, Math.max(0.18, ratio)) * 100}%` }}
        className="flex min-h-0 min-w-0 shrink-0 grow-0 flex-row"
      >
        {orderedTerminals.map((pane) => (
          <div key={pane.id} className="min-h-0 min-w-0 flex-1">
            <PaneFrame pane={pane} />
          </div>
        ))}
      </div>
    </div>
  );
}
