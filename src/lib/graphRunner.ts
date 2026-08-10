import {
  parentsOf,
  type Graph,
  type GraphNode,
  type GraphRun,
  type NodeRun,
} from "./graph";
import { renderTemplate, topoOrder, validate } from "./scheduler";
import type { FileChange, RunMode, Runner } from "./run";

/**
 * Everything the runner needs from the outside world, injected so the whole
 * execution path — fan-out, retries, worktrees — runs headlessly under test.
 */
export type GraphApi = {
  startRun: (opts: {
    runId: string;
    nodeId: string;
    prompt: string;
    runner: Runner;
    mode: RunMode;
    cwd: string;
    worktree?: string;
    branch?: string;
    write: boolean;
  }) => Promise<void>;
  /** Resolves when that run finishes. */
  awaitRun: (runId: string) => Promise<{
    status: string;
    summary?: string | null;
    filesChanged: FileChange[];
  }>;
  cancelRun: (runId: string) => Promise<void>;
  newId: () => string;
  /** Installed runners, in the order builders should be spread across them. */
  installedRunners: () => Runner[];
  worktree?: {
    base: () => Promise<string>;
    add: (nodeId: string, base: string) => Promise<{ path: string; branch: string }>;
    commit: (path: string, message: string) => Promise<string>;
    remove: (path: string) => Promise<void>;
  };
  runSetup?: (cwd: string, command: string) => Promise<void>;
};

export type RunGraphOptions = {
  graph: Graph;
  input: string;
  workspaceId: string;
  cwd: string;
  api: GraphApi;
  defaultRunner: Runner;
  onUpdate?: (run: GraphRun) => void;
  signal?: { cancelled: boolean };
};

const MODE_FOR: Record<string, RunMode> = {
  planner: "plan",
  builder: "build",
  verifier: "verify",
  aggregator: "chat",
  prompt: "chat",
  coordinator: "chat",
  shell: "shell",
};

function summarizeFiles(files: FileChange[]): string {
  if (files.length === 0) return "(no files changed)";
  return files
    .map((f) => `${f.status} ${f.path} (+${f.added} −${f.deleted})`)
    .join("\n");
}

/** Verdict from a verifier: a shell exit code, or PASS/FAIL in the text. */
export function readVerdict(
  node: GraphNode,
  result: { status: string; summary?: string | null },
): boolean {
  if (node.command?.trim()) return result.status === "ok";
  const text = result.summary ?? "";
  // Lenient on purpose: models drift on exact wording, and a verifier whose
  // verdict fails to parse would block the whole graph.
  if (/\bVERDICT\s*[:=]?\s*FAIL\b/i.test(text)) return false;
  if (/\bVERDICT\s*[:=]?\s*PASS\b/i.test(text)) return true;
  if (/\bfail(ed|s|ure)?\b/i.test(text) && !/\bno (issues|failures)\b/i.test(text)) {
    return false;
  }
  return result.status === "ok";
}

export async function runGraph({
  graph,
  input,
  workspaceId,
  cwd,
  api,
  defaultRunner,
  onUpdate,
  signal,
}: RunGraphOptions): Promise<GraphRun> {
  const problems = validate(graph);
  if (problems.length > 0) throw new Error(problems.join(" "));

  const run: GraphRun = {
    id: api.newId(),
    graphId: graph.id,
    workspaceId,
    input,
    status: "running",
    startedAt: Date.now(),
    nodeRuns: {},
  };
  for (const node of graph.nodes) {
    run.nodeRuns[node.id] = { nodeId: node.id, status: "pending", retries: 0 };
  }
  const emit = () => onUpdate?.({ ...run, nodeRuns: { ...run.nodeRuns } });
  emit();

  const setNode = (nodeId: string, patch: Partial<NodeRun>) => {
    run.nodeRuns[nodeId] = { ...run.nodeRuns[nodeId], ...patch };
    emit();
  };

  const cancelled = () => signal?.cancelled === true;
  const outputs = new Map<string, string>();
  const changed = new Map<string, FileChange[]>();
  const lastResult = new Map<string, { status: string; summary?: string | null }>();
  let plan = "";

  const builderNodes = graph.nodes.filter((n) => n.type === "builder");
  const needsWorktrees = builderNodes.length > 1 && !!api.worktree;
  let base: string | undefined;

  const cleanup: string[] = [];

  const executeNode = async (node: GraphNode, feedback: string): Promise<boolean> => {
    // Prompt and coordinator nodes are wiring, not work.
    if (node.type === "prompt") {
      outputs.set(node.id, renderTemplate(node.promptTemplate, { input }));
      setNode(node.id, { status: "ok", output: outputs.get(node.id) });
      return true;
    }
    if (node.type === "coordinator") {
      const parentText = parentsOf(graph, node.id)
        .map((p) => outputs.get(p.id) ?? "")
        .filter(Boolean)
        .join("\n\n");
      outputs.set(node.id, parentText || input);
      setNode(node.id, { status: "ok", output: outputs.get(node.id) });
      return true;
    }

    const parentText = parentsOf(graph, node.id)
      .map((p) => outputs.get(p.id) ?? "")
      .filter(Boolean)
      .join("\n\n");

    const files = parentsOf(graph, node.id)
      .flatMap((p) => changed.get(p.id) ?? []);

    const prompt =
      node.type === "shell"
        ? (node.command ?? node.promptTemplate ?? "")
        : renderTemplate(node.promptTemplate, {
            input,
            parent: parentText,
            plan: plan || parentText || input,
            feedback,
            files: summarizeFiles(files),
          });

    const runId = api.newId();
    const mode = MODE_FOR[node.type] ?? "chat";
    const runner: Runner = node.type === "shell" ? "shell" : (node.runner ?? defaultRunner);

    let worktree: string | undefined;
    let branch: string | undefined;
    if (node.type === "builder" && needsWorktrees && base && api.worktree) {
      try {
        const made = await api.worktree.add(node.id, base);
        worktree = made.path;
        branch = made.branch;
        cleanup.push(made.path);
        if (node.setupCommand?.trim() && api.runSetup) {
          // A fresh worktree has no node_modules; without this a builder that
          // runs tests fails before it starts.
          await api.runSetup(made.path, node.setupCommand);
        }
      } catch (error) {
        setNode(node.id, { status: "failed", error: String(error) });
        return false;
      }
    }

    setNode(node.id, { status: "running", runId, branch, worktree });

    try {
      await api.startRun({
        runId,
        nodeId: node.id,
        prompt,
        runner,
        mode,
        cwd,
        worktree,
        branch,
        write: node.type === "builder" || node.type === "shell",
      });
    } catch (error) {
      setNode(node.id, { status: "failed", error: String(error) });
      return false;
    }

    const result = await api.awaitRun(runId);
    const output = result.summary?.trim() || "";
    outputs.set(node.id, output);
    changed.set(node.id, result.filesChanged);
    lastResult.set(node.id, result);
    if (node.type === "planner") plan = output;

    if (node.type === "builder" && worktree && api.worktree) {
      try {
        const tip = await api.worktree.commit(worktree, `layera: ${node.title}`);
        setNode(node.id, { tip });
      } catch {
        // A builder that changed nothing has nothing to commit; not fatal.
      }
    }

    const ok = result.status === "ok";
    setNode(node.id, {
      status: ok ? "ok" : result.status === "cancelled" ? "cancelled" : "failed",
      output,
      error: ok ? undefined : `run ${result.status}`,
    });
    return ok;
  };

  try {
    if (needsWorktrees && api.worktree) {
      base = await api.worktree.base();
      run.baseCommit = base;
    }

    const waves = topoOrder(graph);

    for (const wave of waves) {
      if (cancelled()) break;

      // Spread builders across the installed runners so a wave genuinely
      // compares different agents rather than running one three times.
      const installed = api.installedRunners();
      const buildersInWave = wave.filter((n) => n.type === "builder");
      buildersInWave.forEach((node, i) => {
        if (!node.runner && installed.length > 0) {
          node.runner = installed[i % installed.length];
        }
      });

      const verifiers = wave.filter((n) => n.type === "verifier");
      const others = wave.filter((n) => n.type !== "verifier");

      await Promise.all(others.map((node) => executeNode(node, "")));

      // Verifiers run last in their wave and can send work back.
      for (const verifier of verifiers) {
        if (cancelled()) break;
        let attempt = 0;
        const maxRetries = verifier.maxRetries ?? 0;
        for (;;) {
          const ran = await executeNode(verifier, "");
          // The verdict is the verifier's judgement, not its exit code: a
          // prompt-based reviewer that says FAIL still exits 0.
          const result = lastResult.get(verifier.id);
          const passed = ran && (!result || readVerdict(verifier, result));
          if (!passed && ran) {
            setNode(verifier.id, {
              status: "failed",
              error: "Review did not pass",
            });
          }
          if (passed || attempt >= maxRetries || cancelled()) break;
          attempt += 1;
          setNode(verifier.id, { retries: attempt });

          const feedback = [
            "The previous attempt did not pass review.",
            outputs.get(verifier.id) ?? "",
          ]
            .filter(Boolean)
            .join("\n\n");

          const retryTargets = parentsOf(graph, verifier.id).filter(
            (n) => n.type === "builder",
          );
          await Promise.all(
            retryTargets.map((node) => {
              setNode(node.id, {
                status: "running",
                retries: (run.nodeRuns[node.id]?.retries ?? 0) + 1,
              });
              return executeNode(node, feedback);
            }),
          );
        }
      }
    }

    const states = Object.values(run.nodeRuns);
    run.status = cancelled()
      ? "cancelled"
      : states.some((n) => n.status === "failed")
        ? "failed"
        : "ok";
  } catch (error) {
    run.status = "failed";
    for (const nodeRun of Object.values(run.nodeRuns)) {
      if (nodeRun.status === "running") {
        nodeRun.status = "failed";
        nodeRun.error = String(error);
      }
    }
  } finally {
    run.finishedAt = Date.now();
    emit();
  }

  return run;
}
