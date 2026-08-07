import { useEffect, useRef } from "react";
import { useApp, type Message } from "../../store/app";
import { RUNNER_LABEL, formatDuration } from "../../lib/run";
import { RunLog } from "./RunLog";

function StepList({ steps, workspaceId }: { steps: { text: string }[]; workspaceId: string }) {
  const pushPlanToBoard = useApp((s) => s.pushPlanToBoard);
  if (steps.length === 0) return null;
  return (
    <div className="mt-2 rounded border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-faint">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => void pushPlanToBoard(workspaceId, steps)}
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-accent transition-colors hover:bg-hover"
        >
          Send to board
        </button>
      </div>
      <ol className="px-2.5 py-1.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2 py-0.5 text-[12px] text-muted">
            <span className="shrink-0 tabular-nums text-faint">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const run = useApp((s) => (message.runId ? s.runs[message.runId] : undefined));
  const openDiff = useApp((s) => s.openDiff);
  const record = run?.record;
  const running = record?.status === "running";

  if (message.role === "user") {
    return (
      <div className="px-3 py-2">
        <div className="rounded bg-raised px-2.5 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div className="px-3 py-2 text-[12px] leading-relaxed text-warn">
        {message.text}
      </div>
    );
  }

  const changed = record?.filesChanged ?? [];

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-1.5 pb-1 text-[10px] text-faint">
        <span>{record ? RUNNER_LABEL[record.runner] : "…"}</span>
        {run?.fellBack && record && (
          <span className="text-warn">
            · fell back from {RUNNER_LABEL[record.requestedRunner]}
          </span>
        )}
        {record && !running && <span>· {formatDuration(record.durationMs)}</span>}
        {record?.parserDegraded && <span className="text-warn">· raw output</span>}
        {record && record.status !== "ok" && record.status !== "running" && (
          <span className="text-[#d47a5c]">· {record.status}</span>
        )}
      </div>

      {message.text ? (
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
          {message.text}
        </div>
      ) : (
        running && <div className="text-[13px] text-faint">thinking…</div>
      )}

      {message.steps && (
        <StepList steps={message.steps} workspaceId={record?.workspaceId ?? ""} />
      )}

      {changed.length > 0 && record && (
        <button
          type="button"
          onClick={() =>
            openDiff(record.workspaceId, record.runId, record.label || "Changes")
          }
          className="mt-2 flex w-full items-center gap-2 rounded border border-line bg-panel px-2.5 py-1.5 text-left text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-ink"
        >
          <span>
            {changed.length} file{changed.length === 1 ? "" : "s"} changed
          </span>
          <span className="text-ok">
            +{changed.reduce((n, c) => n + c.added, 0)}
          </span>
          <span className="text-[#d47a5c]">
            −{changed.reduce((n, c) => n + c.deleted, 0)}
          </span>
          <span className="ml-auto text-accent">Review</span>
        </button>
      )}

      {run && (running || run.events.length > 0) && <RunLog run={run} />}
    </div>
  );
}

export function Thread({
  messages,
  workspaceId,
}: {
  messages: Message[];
  workspaceId: string;
}) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, workspaceId]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-[13px] text-muted">Ask, plan, or build</p>
        <p className="text-[11px] leading-relaxed text-faint">
          Runs happen headlessly in this workspace's folder, using the CLI you
          already have installed.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-1">
      {messages.map((m) => (
        <Bubble key={m.id} message={m} />
      ))}
      <div ref={bottom} />
    </div>
  );
}
