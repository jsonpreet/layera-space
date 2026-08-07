import { invoke } from "@tauri-apps/api/core";

export type Runner = "claude" | "codex" | "opencode" | "shell";
export type RunMode = "chat" | "plan" | "build" | "verify" | "shell";
export type RunStatus = "running" | "ok" | "error" | "cancelled" | "timeout";

export type EventKind =
  | "stdout"
  | "stderr"
  | "assistant"
  | "thinking"
  | "tool"
  | "tool_result"
  | "usage"
  | "result"
  | "error"
  | "raw";

export type RunEvent = {
  seq: number;
  /** Seconds since the process started. */
  t: number;
  kind: EventKind;
  text?: string;
  tool?: string;
  data?: unknown;
  truncated?: boolean;
};

export type FileChange = {
  path: string;
  status: string;
  added: number;
  deleted: number;
};

export type RunRecord = {
  runId: string;
  workspaceId: string;
  runner: Runner;
  requestedRunner: Runner;
  runnerVersion?: string | null;
  mode: RunMode;
  label?: string | null;
  promptPreview: string;
  cwd: string;
  dir: string;
  transcriptPath: string;
  status: RunStatus;
  exitCode?: number | null;
  startedAt: number;
  durationMs: number;
  baseTree?: string | null;
  afterTree?: string | null;
  repoRoot?: string | null;
  filesChanged: FileChange[];
  parserDegraded: boolean;
  summary?: string | null;
  graphRunId?: string | null;
  nodeId?: string | null;
  branch?: string | null;
  worktree?: string | null;
};

export type ContextBlock = { label: string; content: string };

export type RunSpec = {
  runId: string;
  workspaceId: string;
  runner: Runner;
  prompt: string;
  cwd: string;
  mode: RunMode;
  /** Undefined lets the mode decide: chat and plan read-only, build writes. */
  write?: boolean;
  allowFallback?: boolean;
  context?: ContextBlock[];
  env?: Record<string, string>;
  label?: string;
  graphRunId?: string;
  nodeId?: string;
  captureDiff?: boolean;
  timeoutMs?: number;
  runnerPaths?: Record<string, string>;
  plain?: boolean;
  branch?: string;
  worktree?: string;
};

export type SpawnPayload = {
  runId: string;
  runner: Runner;
  requestedRunner: Runner;
  fellBack: boolean;
  program: string;
  args: string[];
  cwd: string;
  startedAt: number;
};

export type EventsPayload = { runId: string; events: RunEvent[] };
export type ExitPayload = { runId: string; record: RunRecord };

export const RUNNER_LABEL: Record<Runner, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  shell: "Shell",
};

/**
 * The exact flags a spec will produce, so the composer can show the user what
 * is actually being handed to their CLI rather than describing it vaguely.
 */
export function describeFlags(runner: Runner, write: boolean): string {
  switch (runner) {
    case "claude":
      return write
        ? "claude -p --permission-mode acceptEdits"
        : "claude -p (read-only)";
    case "codex":
      return write ? "codex exec -s workspace-write" : "codex exec -s read-only";
    case "opencode":
      return write ? "opencode run --auto" : "opencode run (asks to apply)";
    case "shell":
      return "shell command";
  }
}

export function startRun(spec: RunSpec): Promise<RunRecord> {
  return invoke<RunRecord>("run_start", { spec });
}

export function cancelRun(runId: string): Promise<boolean> {
  return invoke<boolean>("run_cancel", { runId });
}

export function cancelAllRuns(workspaceId?: string): Promise<number> {
  return invoke<number>("run_cancel_all", { workspaceId: workspaceId ?? null });
}

export function liveRuns(): Promise<string[]> {
  return invoke<string[]>("run_live");
}

export function listRuns(workspaceId: string): Promise<RunRecord[]> {
  return invoke<RunRecord[]>("run_list", { workspaceId });
}

export function readTranscript(path: string): Promise<string> {
  return invoke<string>("run_read_transcript", { path });
}

export function runPatch(workspaceId: string, runId: string): Promise<string> {
  return invoke<string>("run_patch", { workspaceId, runId });
}

export function runsGc(workspaceId: string): Promise<number> {
  return invoke<number>("runs_gc", { workspaceId });
}

export function reconcileRuns(workspaceId: string): Promise<void> {
  return invoke("runs_reconcile", { workspaceId });
}

// -------------------------------------------------------------------- git

export function gitRoot(dir: string): Promise<string | null> {
  return invoke<string | null>("git_root", { dir });
}

export function gitInit(dir: string): Promise<string> {
  return invoke<string>("git_init", { dir });
}

export function gitShow(
  root: string,
  rev: string,
  path: string,
): Promise<string> {
  return invoke<string>("git_show", { root, rev, path });
}

export function gitTakeFiles(
  root: string,
  rev: string,
  paths: string[],
): Promise<void> {
  return invoke("git_take_files", { root, rev, paths });
}

export function gitApply(
  root: string,
  patch: string,
  reverse = false,
): Promise<void> {
  return invoke("git_apply", { root, patch, reverse });
}

export function gitWaveBase(root: string, indexPath: string): Promise<string> {
  return invoke<string>("git_wave_base", { root, indexPath });
}

export function gitDiffFiles(
  root: string,
  base: string,
  after: string,
): Promise<FileChange[]> {
  return invoke<FileChange[]>("git_diff_files", { root, base, after });
}

export function gitDiffPatch(
  root: string,
  base: string,
  after: string,
): Promise<string> {
  return invoke<string>("git_diff_patch", { root, base, after });
}

export function worktreeAdd(
  root: string,
  path: string,
  branch: string,
  base: string,
): Promise<string> {
  return invoke<string>("worktree_add", { root, path, branch, base });
}

export function worktreeRemove(root: string, path: string): Promise<void> {
  return invoke("worktree_remove", { root, path });
}

export function worktreeCommit(
  path: string,
  message: string,
): Promise<string> {
  return invoke<string>("worktree_commit", { path, message });
}

export function gitBranches(root: string, prefix = ""): Promise<string[]> {
  return invoke<string[]>("git_branches", { root, prefix });
}

export function gitBranchDelete(root: string, branch: string): Promise<void> {
  return invoke("git_branch_delete", { root, branch });
}

/** Human-readable duration for run chips and history rows. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
