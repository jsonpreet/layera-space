import { useCallback, useEffect, useRef } from "react";
import { threadFor, useApp } from "../../store/app";
import { IconClose } from "../icons";
import { Composer } from "./Composer";
import { Thread } from "./Thread";

export function Rail() {
  const open = useApp((s) => s.settings.railOpen);
  const width = useApp((s) => s.settings.railWidth);
  const workspaceId = useApp((s) => s.activeWorkspaceId);
  const thread = useApp((s) =>
    workspaceId ? threadFor(s.rail, workspaceId) : null,
  );
  const { setRailOpen, setRailWidth, clearThread } = useApp();
  const dragging = useRef(false);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const move = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // The rail is anchored right, so width grows as the pointer moves left.
        setRailWidth(window.innerWidth - ev.clientX);
      };
      const up = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [setRailWidth],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setRailOpen(!useApp.getState().settings.railOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setRailOpen]);

  if (!open || !workspaceId || !thread) return null;

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l border-line bg-base"
      style={{ width }}
    >
      <div className="relative flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel pl-3 pr-1.5">
        <div
          onMouseDown={startDrag}
          className="absolute -left-0.5 top-0 h-full w-1 cursor-col-resize"
          title="Drag to resize"
        />
        <span className="text-xs text-muted">Composer</span>
        {thread.messages.length > 0 && (
          <button
            type="button"
            onClick={() => clearThread(workspaceId)}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-hover hover:text-muted"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          title="Close  ⌘J"
          onClick={() => setRailOpen(false)}
          className={`rounded p-1 text-faint transition-colors hover:bg-hover hover:text-ink ${
            thread.messages.length > 0 ? "" : "ml-auto"
          }`}
        >
          <IconClose />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <Thread messages={thread.messages} workspaceId={workspaceId} />
      </div>

      <Composer workspaceId={workspaceId} />
    </aside>
  );
}
