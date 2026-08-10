import { AGENT_ORDER, AGENTS } from "../../lib/agents";
import { NODE_HINT, type GraphNode, type NodeRun } from "../../lib/graph";
import type { Runner } from "../../lib/run";
import { IconClose } from "../icons";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block px-3 py-2">
      <span className="block pb-1 text-[10px] uppercase tracking-wide text-faint">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-faint">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded border border-line bg-base px-2 py-1 text-[12px] text-ink outline-none focus:border-accent/50";

export function Inspector({
  node,
  nodeRun,
  onChange,
  onDelete,
  onClose,
}: {
  node: GraphNode;
  nodeRun?: NodeRun;
  onChange: (node: GraphNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const patch = (p: Partial<GraphNode>) => onChange({ ...node, ...p });

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <span className="truncate text-xs text-muted">{node.title}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <IconClose />
        </button>
      </div>

      <p className="px-3 pt-2 text-[11px] leading-relaxed text-faint">
        {NODE_HINT[node.type]}
      </p>

      <Field label="Title">
        <input
          value={node.title}
          onChange={(e) => patch({ title: e.target.value })}
          className={inputClass}
          spellCheck={false}
        />
      </Field>

      {node.type !== "prompt" && node.type !== "shell" && (
        <Field
          label="Runner"
          hint="Leave on Automatic to spread parallel builders across the CLIs you have installed."
        >
          <select
            value={node.runner ?? ""}
            onChange={(e) =>
              patch({ runner: (e.target.value || undefined) as Runner | undefined })
            }
            className={inputClass}
          >
            <option value="">Automatic</option>
            {AGENT_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {AGENTS[kind].name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {node.type === "coordinator" && (
        <Field label="Builders" hint="How many agents attempt the task at once.">
          <input
            type="number"
            min={1}
            max={6}
            value={node.builders ?? 3}
            onChange={(e) =>
              patch({ builders: Math.max(1, Number(e.target.value) || 1) })
            }
            className={inputClass}
          />
        </Field>
      )}

      {node.type === "verifier" && (
        <>
          <Field
            label="Check command"
            hint="Leave empty to have the runner review the changes and answer PASS or FAIL."
          >
            <input
              value={node.command ?? ""}
              onChange={(e) => patch({ command: e.target.value })}
              placeholder="npm test"
              className={inputClass}
              spellCheck={false}
            />
          </Field>
          <Field
            label="Max retries"
            hint="How many times a failure is sent back to the builders."
          >
            <input
              type="number"
              min={0}
              max={5}
              value={node.maxRetries ?? 1}
              onChange={(e) =>
                patch({ maxRetries: Math.max(0, Number(e.target.value) || 0) })
              }
              className={inputClass}
            />
          </Field>
        </>
      )}

      {node.type === "builder" && (
        <>
          <Field
            label="Setup command"
            hint="Runs in the fresh worktree before the agent. A new worktree has no node_modules."
          >
            <input
              value={node.setupCommand ?? ""}
              onChange={(e) => patch({ setupCommand: e.target.value })}
              placeholder="npm ci"
              className={inputClass}
              spellCheck={false}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={node.linkDeps ?? true}
              onChange={(e) => patch({ linkDeps: e.target.checked })}
              className="h-3 w-3 accent-[#c98f52]"
            />
            Link dependencies from the main folder
          </label>
        </>
      )}

      {node.type === "shell" ? (
        <Field label="Command">
          <textarea
            value={node.command ?? ""}
            onChange={(e) => patch({ command: e.target.value })}
            rows={3}
            placeholder="npm run build"
            className={`${inputClass} resize-none font-mono`}
            spellCheck={false}
          />
        </Field>
      ) : (
        <Field
          label="Prompt"
          hint="{{input}} {{parent}} {{plan}} {{feedback}} {{files}}"
        >
          <textarea
            value={node.promptTemplate ?? ""}
            onChange={(e) => patch({ promptTemplate: e.target.value })}
            rows={5}
            className={`${inputClass} resize-none`}
            spellCheck={false}
          />
        </Field>
      )}

      {nodeRun && nodeRun.status !== "pending" && (
        <div className="border-t border-line px-3 py-2">
          <span className="block pb-1 text-[10px] uppercase tracking-wide text-faint">
            Last run
          </span>
          <p className="text-[11px] text-muted">
            {nodeRun.status}
            {nodeRun.retries > 0 && ` · ${nodeRun.retries} retr${nodeRun.retries === 1 ? "y" : "ies"}`}
          </p>
          {nodeRun.branch && (
            <p className="mt-1 truncate font-mono text-[10px] text-faint" title={nodeRun.branch}>
              {nodeRun.branch}
            </p>
          )}
          {nodeRun.error && (
            <p className="mt-1 text-[11px] text-[#d47a5c]">{nodeRun.error}</p>
          )}
          {nodeRun.output && (
            <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
              {nodeRun.output}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto shrink-0 border-t border-line px-3 py-2 text-left text-[11px] text-muted transition-colors hover:bg-hover hover:text-[#d47a5c]"
      >
        Delete node
      </button>
    </aside>
  );
}
