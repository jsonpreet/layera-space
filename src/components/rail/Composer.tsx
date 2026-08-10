import { useEffect, useRef } from "react";
import { AGENT_ORDER, AGENTS } from "../../lib/agents";
import { RUNNER_LABEL, describeFlags, type Runner } from "../../lib/run";
import { threadFor, useApp, type RailMode } from "../../store/app";

const MODES: { value: RailMode; label: string; hint: string }[] = [
  { value: "chat", label: "Chat", hint: "Ask about the code. Read-only." },
  { value: "plan", label: "Plan", hint: "Draft steps. Writes nothing." },
  { value: "build", label: "Build", hint: "Implement the change." },
];

export function Composer({ workspaceId }: { workspaceId: string }) {
  const settings = useApp((s) => s.settings);
  const thread = useApp((s) => threadFor(s.rail, workspaceId));
  const agents = useApp((s) => s.agents);
  const {
    setDraft,
    setRailMode,
    setRailRunner,
    setRailWrite,
    submitComposer,
    cancelComposer,
  } = useApp();

  const box = useRef<HTMLTextAreaElement>(null);
  const running = !!thread.activeRunId;
  const mode = settings.railMode;
  const runner = settings.railRunner;
  const write = mode === "build" && settings.railWrite;

  // Grow with the content instead of scrolling a two-line box.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [thread.draft]);

  const installed = (r: Runner) =>
    r === "shell" ||
    agents[r as keyof typeof agents] !== null ||
    !!settings.runnerPaths[r];

  return (
    <div className="shrink-0 border-t border-line bg-panel">
      <div className="flex items-center gap-1 px-2 pt-2">
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              title={m.hint}
              onClick={() => setRailMode(m.value)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                active
                  ? "bg-hover text-ink"
                  : "text-faint hover:bg-hover hover:text-muted"
              }`}
            >
              {m.label}
            </button>
          );
        })}

        <select
          value={runner}
          onChange={(e) => setRailRunner(e.target.value as Runner)}
          className="ml-auto rounded bg-transparent py-0.5 pr-1 text-[11px] text-muted outline-none hover:text-ink"
          title="Which CLI runs this"
        >
          {AGENT_ORDER.map((kind) => (
            <option key={kind} value={kind} className="bg-raised text-ink">
              {AGENTS[kind].name}
              {installed(kind) ? "" : " (not installed)"}
            </option>
          ))}
          <option value="shell" className="bg-raised text-ink">
            Shell
          </option>
        </select>
      </div>

      <div className="px-2 pt-1.5">
        <textarea
          ref={box}
          value={thread.draft}
          onChange={(e) => setDraft(workspaceId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submitComposer(workspaceId);
            }
          }}
          rows={2}
          placeholder={
            mode === "build"
              ? "Describe the change to make…"
              : mode === "plan"
                ? "Describe what to plan…"
                : "Ask a question…"
          }
          className="w-full resize-none rounded border border-line bg-base px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/50"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-2 px-2 pb-2 pt-1.5">
        {mode === "build" ? (
          <label
            className="flex cursor-pointer items-center gap-1.5 text-[10px] text-faint transition-colors hover:text-muted"
            title="Passes the edit flag through to the CLI"
          >
            <input
              type="checkbox"
              checked={settings.railWrite}
              onChange={(e) => setRailWrite(e.target.checked)}
              className="h-3 w-3 accent-[#c98f52]"
            />
            can edit files
          </label>
        ) : (
          <span className="text-[10px] text-faint">read-only</span>
        )}

        <span
          className="min-w-0 truncate text-[10px] text-faint"
          title={describeFlags(runner, write)}
        >
          {describeFlags(runner, write)}
        </span>

        {running ? (
          <button
            type="button"
            onClick={() => void cancelComposer(workspaceId)}
            className="ml-auto shrink-0 rounded px-2.5 py-1 text-[11px] text-warn transition-colors hover:bg-hover"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void submitComposer(workspaceId)}
            disabled={!thread.draft.trim()}
            title={`${mode === "build" ? "Build" : mode === "plan" ? "Plan" : "Send"}  ⌘↵`}
            className="ml-auto shrink-0 rounded bg-accent-deep px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-accent disabled:bg-raised disabled:text-faint"
          >
            {mode === "build" ? "Build" : mode === "plan" ? "Plan" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}

export { RUNNER_LABEL };
