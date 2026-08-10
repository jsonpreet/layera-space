import { useEffect, useMemo, useState } from "react";
import { builderAncestors, type Graph, type GraphRun, type GraphNode } from "../../lib/graph";
import {
  gitApply,
  gitBranchDelete,
  gitDiffFiles,
  gitDiffPatch,
  gitRoot,
  type FileChange,
} from "../../lib/run";
import { useApp } from "../../store/app";
import { IconClose } from "../icons";

type BranchState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; files: FileChange[]; patch: string };

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2.5">
      <span className="truncate text-xs text-muted">{title}</span>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto rounded p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <IconClose />
      </button>
    </div>
  );
}

export function ComparePanel({
  node,
  graph,
  graphRun,
  workspaceId,
  onClose,
}: {
  node: GraphNode;
  graph: Graph;
  graphRun?: GraphRun;
  workspaceId: string;
  onClose: () => void;
}) {
  const workspace = useApp((s) => s.workspaces.find((w) => w.id === workspaceId));
  const builders = useMemo(() => builderAncestors(graph, node.id), [graph, node.id]);
  const [root, setRoot] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, BranchState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const base = graphRun?.baseCommit;
  const done = !!graphRun && graphRun.status !== "running" && !!base;

  useEffect(() => {
    if (!workspace?.folder) return;
    void gitRoot(workspace.folder).then(setRoot).catch(() => setRoot(null));
  }, [workspace?.folder]);

  useEffect(() => {
    if (!done || !root || !graphRun) return;
    for (const builder of builders) {
      const tip = graphRun.nodeRuns[builder.id]?.tip;
      if (!tip || states[builder.id]) continue;
      void loadBranch(builder.id, tip);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, root, builders.length]);

  async function loadBranch(builderId: string, tip: string) {
    if (!root || !base) return;
    setStates((s) => ({ ...s, [builderId]: { phase: "loading" } }));
    try {
      const [files, patch] = await Promise.all([
        gitDiffFiles(root, base, tip),
        gitDiffPatch(root, base, tip),
      ]);
      setStates((s) => ({ ...s, [builderId]: { phase: "ready", files, patch } }));
    } catch (error) {
      setStates((s) => ({
        ...s,
        [builderId]: { phase: "error", error: String(error) },
      }));
    }
  }

  async function applyBranch(builderId: string) {
    const state = states[builderId];
    if (state?.phase !== "ready" || !root) return;
    setMessages((m) => ({ ...m, [builderId]: "applying…" }));
    try {
      await gitApply(root, state.patch);
      setMessages((m) => ({ ...m, [builderId]: "Applied to your tree" }));
    } catch (error) {
      setMessages((m) => ({ ...m, [builderId]: String(error) }));
    }
  }

  async function deleteBranch(builder: GraphNode) {
    const branch = graphRun?.nodeRuns[builder.id]?.branch;
    if (!root || !branch) return;
    try {
      await gitBranchDelete(root, branch);
      setStates((s) => {
        const next = { ...s };
        delete next[builder.id];
        return next;
      });
      setMessages((m) => ({ ...m, [builder.id]: "Branch deleted" }));
    } catch (error) {
      setMessages((m) => ({ ...m, [builder.id]: String(error) }));
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <Header title={`${node.title} — results`} onClose={onClose} />

      {!done && (
        <p className="px-3 py-2 text-[11px] text-faint">
          Run the graph to see each builder's branch compared against the wave base.
        </p>
      )}
      {done && builders.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-faint">
          No builders feed this node, so there is nothing to compare.
        </p>
      )}

      {done &&
        builders.map((builder) => {
          const state = states[builder.id];
          const nodeRun = graphRun?.nodeRuns[builder.id];
          const message = messages[builder.id];
          return (
            <div key={builder.id} className="border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12px] text-ink">{builder.title}</span>
                {nodeRun?.branch && (
                  <span className="truncate font-mono text-[10px] text-faint">
                    {nodeRun.branch}
                  </span>
                )}
              </div>

              {!state && (
                <p className="mt-1 text-[11px] text-faint">
                  {nodeRun?.tip ? "Reading diff…" : "This builder produced no commits."}
                </p>
              )}
              {state?.phase === "loading" && (
                <p className="mt-1 text-[11px] text-faint">Reading diff…</p>
              )}
              {state?.phase === "error" && (
                <p className="mt-1 text-[11px] text-[#d47a5c]">{state.error}</p>
              )}
              {state?.phase === "ready" && (
                <>
                  {state.files.length === 0 ? (
                    <p className="mt-1 text-[11px] text-faint">
                      No changes on this branch.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === builder.id ? null : builder.id)}
                      className="mt-1 block w-full text-left text-[11px] text-muted transition-colors hover:text-ink"
                    >
                      {state.files.length} file{state.files.length === 1 ? "" : "s"}
                      <span className="ml-1 text-faint">
                        {expanded === builder.id ? "(hide)" : "(diff)"}
                      </span>
                    </button>
                  )}
                  {expanded === builder.id && state.files.length > 0 && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-base px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted">
                      {state.patch || "(empty patch)"}
                    </pre>
                  )}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyBranch(builder.id)}
                      disabled={state.files.length === 0}
                      className="rounded bg-accent-deep px-2 py-0.5 text-[11px] text-ink transition-colors hover:bg-accent disabled:bg-raised disabled:text-faint"
                    >
                      Take this one
                    </button>
                    {nodeRun?.branch && (
                      <button
                        type="button"
                        onClick={() => deleteBranch(builder)}
                        className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-[#d47a5c]"
                      >
                        Delete branch
                      </button>
                    )}
                  </div>
                  {message && (
                    <p
                      className={`mt-1 text-[10px] ${
                        message.includes("Applied") ? "text-[#7fae72]" : "text-[#d47a5c]"
                      }`}
                    >
                      {message}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
    </aside>
  );
}
