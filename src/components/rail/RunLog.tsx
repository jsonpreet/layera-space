import { useEffect, useRef, useState } from "react";
import type { LiveRun } from "../../store/app";
import { MONO_STACK } from "../../lib/theme";
import type { EventKind, RunEvent } from "../../lib/run";

/** Rendering every event of a long run is what makes a log freeze the UI. */
const VISIBLE = 500;

const TONE: Record<EventKind, string> = {
  assistant: "text-ink",
  thinking: "text-faint",
  tool: "text-accent",
  tool_result: "text-muted",
  stdout: "text-muted",
  stderr: "text-warn",
  usage: "text-faint",
  result: "text-ink",
  error: "text-[#d47a5c]",
  raw: "text-faint",
};

function lineFor(ev: RunEvent): string | null {
  if (ev.kind === "tool") return `→ ${ev.tool ?? "tool"}`;
  if (ev.kind === "tool_result") return `← ${ev.tool ?? "done"}`;
  if (ev.kind === "usage") return null;
  return ev.text ?? null;
}

export function RunLog({ run }: { run: LiveRun }) {
  const [open, setOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const events = run.events.filter((e) => lineFor(e) !== null);
  const shown = events.slice(-VISIBLE);
  const hidden = events.length - shown.length;

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [run.events.length, open]);

  const running = run.record.status === "running";

  return (
    <div className="mt-1.5 overflow-hidden rounded border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] text-faint transition-colors hover:bg-hover hover:text-muted"
      >
        <span className="w-2 shrink-0 text-center">{open ? "v" : ">"}</span>
        <span>
          {running ? "running" : "log"} · {events.length} event
          {events.length === 1 ? "" : "s"}
        </span>
        {run.command && (
          <span className="ml-auto max-w-[55%] truncate" title={run.command}>
            {run.command}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            // Only auto-scroll while the user is already at the bottom.
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="max-h-52 overflow-y-auto border-t border-line px-2 py-1.5 text-[11px] leading-relaxed"
          style={{ fontFamily: MONO_STACK }}
        >
          {hidden > 0 && (
            <div className="pb-1 text-faint">
              {hidden.toLocaleString()} earlier line
              {hidden === 1 ? "" : "s"} — full transcript on disk
            </div>
          )}
          {shown.length === 0 && (
            <div className="text-faint">{running ? "waiting…" : "no output"}</div>
          )}
          {shown.map((ev) => (
            <div
              key={ev.seq}
              className={`whitespace-pre-wrap break-words ${TONE[ev.kind]}`}
            >
              {lineFor(ev)}
              {ev.truncated && <span className="text-faint"> …truncated</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
