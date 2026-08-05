import { useRef } from "react";
import type { LayoutNode } from "../lib/layout";
import { useApp } from "../store/app";
import { PaneFrame } from "./PaneFrame";

export function LayoutView({
  wsId,
  node,
  path,
}: {
  wsId: string;
  node: LayoutNode;
  path: number[];
}) {
  const { panes, setSplitRatio } = useApp();

  if (node.type === "leaf") {
    const pane = panes.find((p) => p.id === node.paneId);
    if (!pane) return null;
    return <PaneFrame pane={pane} />;
  }

  const horizontal = node.dir === "h";

  return (
    <SplitView
      wsId={wsId}
      node={node}
      path={path}
      horizontal={horizontal}
      setSplitRatio={setSplitRatio}
    />
  );
}

function SplitView({
  wsId,
  node,
  path,
  horizontal,
  setSplitRatio,
}: {
  wsId: string;
  node: Extract<LayoutNode, { type: "split" }>;
  path: number[];
  horizontal: boolean;
  setSplitRatio: (wsId: string, path: number[], ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const ratio = horizontal
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      setSplitRatio(wsId, path, ratio);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 min-w-0 ${horizontal ? "flex-row" : "flex-col"}`}
    >
      <div
        style={{ flexBasis: `${node.ratio * 100}%` }}
        className="min-h-0 min-w-0 shrink-0 grow-0"
      >
        <LayoutView wsId={wsId} node={node.children[0]} path={[...path, 0]} />
      </div>
      <div
        onMouseDown={startDrag}
        className={`shrink-0 bg-line transition-colors hover:bg-accent/60 ${
          horizontal ? "w-[4px] cursor-col-resize" : "h-[4px] cursor-row-resize"
        }`}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <LayoutView wsId={wsId} node={node.children[1]} path={[...path, 1]} />
      </div>
    </div>
  );
}
