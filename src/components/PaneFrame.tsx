import { lazy, Suspense, useState, type ReactNode } from "react";
import type { Pane } from "../store/app";
import { useApp } from "../store/app";
import { AGENT_TINT } from "../lib/agents";
import { KanbanPane } from "./KanbanPane";
import { ReplayView } from "./ReplayView";
import { BrowserPane } from "./BrowserPane";
import { TermPane } from "./TermPane";
import { Menu } from "./Menu";
import { IconClose, IconSplitH, IconSplitV, IconZoom } from "./icons";

const EditorPane = lazy(() =>
  import("./EditorPane").then(({ EditorPane: Component }) => ({
    default: Component,
  })),
);

const MemoryPane = lazy(() =>
  import("./memory/MemoryPane").then(({ MemoryPane: Component }) => ({
    default: Component,
  })),
);

// React Flow is heavy too, so it loads on demand like Monaco.
const GraphPane = lazy(() =>
  import("./graph/GraphPane").then(({ GraphPane: Component }) => ({
    default: Component,
  })),
);

// Monaco is heavy; both panes that use it load on demand.
const DiffPane = lazy(() =>
  import("./DiffPane").then(({ DiffPane: Component }) => ({
    default: Component,
  })),
);

function HeaderBtn({
  title,
  onClick,
  active,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded p-1 transition-colors ${
        active
          ? "text-accent"
          : danger
            ? "text-muted hover:bg-hover hover:text-[#d47a5c]"
            : "text-faint hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function PaneFrame({ pane }: { pane: Pane }) {
  const {
    closePane,
    splitPane,
    setFocused,
    toggleZoom,
    zoomed,
    reportBell,
    beginRecording,
  } = useApp();
  const isZoomed = zoomed[pane.workspaceId] === pane.id;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  let dotColor = "#7fae72";
  let dotClass = "";
  let stateLabel = "running";
  if (pane.status === "exited") {
    dotColor = "#4a4238";
    stateLabel = "exited";
  } else if (pane.kind === "agent") {
    if (pane.activity === "working") {
      dotColor = "#d3a24b";
      dotClass = "animate-pulse";
      stateLabel = "working";
    } else if (pane.activity === "done") {
      dotColor = "#7fae72";
      stateLabel = `done (${pane.doneSource})`;
    } else {
      dotColor = "#6b6156";
      stateLabel = "idle";
    }
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      onMouseDown={() => setFocused(pane.workspaceId, pane.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line bg-panel pl-2.5 pr-1">
        <span
          title={stateLabel}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
          style={{ background: dotColor }}
        />
        <span className="min-w-0 truncate text-xs text-muted">
          {pane.title}
          {pane.agent && (
            <span
              className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ background: AGENT_TINT[pane.agent] }}
            />
          )}
          {pane.status === "exited" && (
            <span className="ml-1.5 text-[10px] text-faint">exited</span>
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          <HeaderBtn title="Split right" onClick={() => void splitPane(pane.id, "h")}>
            <IconSplitH />
          </HeaderBtn>
          <HeaderBtn title="Split down" onClick={() => void splitPane(pane.id, "v")}>
            <IconSplitV />
          </HeaderBtn>
          <HeaderBtn
            title={isZoomed ? "Unzoom" : "Zoom"}
            active={isZoomed}
            onClick={() => toggleZoom(pane.workspaceId, pane.id)}
          >
            <IconZoom />
          </HeaderBtn>
          <HeaderBtn danger title="Close pane  ⌘W" onClick={() => closePane(pane.id)}>
            <IconClose />
          </HeaderBtn>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {pane.kind === "replay" ? (
          <ReplayView pane={pane} />
        ) : pane.kind === "kanban" ? (
          <KanbanPane pane={pane} />
        ) : pane.kind === "browser" ? (
          <BrowserPane pane={pane} />
        ) : pane.kind === "editor" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-faint">
                Loading editor...
              </div>
            }
          >
            <EditorPane pane={pane} />
          </Suspense>
        ) : pane.kind === "memory" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-faint">
                Loading memory...
              </div>
            }
          >
            <MemoryPane pane={pane} />
          </Suspense>
        ) : pane.kind === "graph" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-faint">
                Loading graph...
              </div>
            }
          >
            <GraphPane pane={pane} />
          </Suspense>
        ) : pane.kind === "diff" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-faint">
                Loading diff...
              </div>
            }
          >
            <DiffPane pane={pane} />
          </Suspense>
        ) : (
          <TermPane
            ptyId={pane.ptyId}
            onBell={() => reportBell(pane.ptyId)}
            onFitted={(cols, rows) => beginRecording(pane.id, cols, rows)}
          />
        )}
      </div>

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Close pane", danger: true, onClick: () => closePane(pane.id) },
            { label: "Split right", onClick: () => void splitPane(pane.id, "h") },
            { label: "Split down", onClick: () => void splitPane(pane.id, "v") },
            {
              label: isZoomed ? "Unzoom" : "Zoom",
              onClick: () => toggleZoom(pane.workspaceId, pane.id),
            },
          ]}
        />
      )}
    </div>
  );
}
