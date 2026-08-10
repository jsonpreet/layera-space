import { useEffect, useState } from "react";
import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import {
  formatDuration,
  gitApply,
  gitShow,
  gitTakeFiles,
  runPatch,
  RUNNER_LABEL,
  type FileChange,
  type RunRecord,
} from "../lib/run";
import { useApp, type Pane } from "../store/app";

loader.config({ monaco });

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    rs: "rust",
    py: "python",
    sh: "shell",
    toml: "ini",
    yml: "yaml",
    yaml: "yaml",
  };
  return map[ext ?? ""] ?? "plaintext";
}

const STATUS_LABEL: Record<string, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
};

/**
 * Review what a run changed, file by file, against the tree as it was before
 * the run started — not against HEAD, so work that was already uncommitted
 * doesn't show up as part of the agent's diff.
 */
export function DiffPane({ pane }: { pane: Pane }) {
  const record = useApp((s) =>
    (s.runHistory[pane.workspaceId] ?? []).find((r) => r.runId === pane.runId),
  );
  const refreshRunHistory = useApp((s) => s.refreshRunHistory);
  const [selected, setSelected] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [reverted, setReverted] = useState<Set<string>>(new Set());

  useEffect(() => {
    void refreshRunHistory(pane.workspaceId);
  }, [pane.workspaceId, pane.runId]);

  const files = record?.filesChanged ?? [];

  useEffect(() => {
    if (!selected && files.length > 0) setSelected(files[0].path);
  }, [files.length]);

  useEffect(() => {
    if (!selected || !record?.repoRoot || !record.baseTree) return;
    setMessage(null);
    const root = record.repoRoot;
    void gitShow(root, record.baseTree, selected)
      .then(setOriginal)
      .catch(() => setOriginal(""));
    void invoke<string>("fs_read_text", { path: `${root}/${selected}` })
      .then(setModified)
      // A deleted file has no working copy; an empty right side is correct.
      .catch(() => setModified(""));
  }, [selected, record?.baseTree, record?.repoRoot]);

  if (!record) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        This run is no longer in the history.
      </div>
    );
  }

  if (!record.repoRoot || !record.baseTree) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-sm text-muted">No diff was captured for this run</p>
        <p className="text-[11px] text-faint">
          The folder isn't a git repository, so there was no before-state to
          compare against.
        </p>
      </div>
    );
  }

  const revertFile = async (path: string) => {
    if (!window.confirm(`Discard this run's changes to ${path}?`)) return;
    const root = record.repoRoot!;
    try {
      const change = files.find((f) => f.path === path);
      if (change?.status === "A") {
        // The file did not exist before the run, so reverting means removing it.
        await invoke("fs_delete", { path: `${root}/${path}` });
      } else {
        await gitTakeFiles(root, record.baseTree!, [path]);
      }
      setReverted((s) => new Set(s).add(path));
      setMessage(`Reverted ${path}`);
      if (selected === path) setModified("");
    } catch (error) {
      setMessage(`Could not revert: ${String(error)}`);
    }
  };

  const revertAll = async () => {
    if (
      !window.confirm(
        `Discard all ${files.length} file change(s) from this run?`,
      )
    )
      return;
    try {
      const patch = await runPatch(record.workspaceId, record.runId);
      if (!patch.trim()) {
        setMessage("No patch was recorded for this run");
        return;
      }
      await gitApply(record.repoRoot!, patch, true);
      setReverted(new Set(files.map((f) => f.path)));
      setMessage("Reverted every change from this run");
    } catch (error) {
      setMessage(`Could not revert: ${String(error)}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <Header record={record} files={files} onRevertAll={() => void revertAll()} />
      {message && (
        <div className="shrink-0 border-b border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
          {message}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-y-auto border-r border-line bg-panel py-1">
          {files.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] text-faint">
              This run changed no files.
            </p>
          )}
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              active={selected === file.path}
              reverted={reverted.has(file.path)}
              onSelect={() => setSelected(file.path)}
              onRevert={() => void revertFile(file.path)}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <DiffEditor
              key={selected}
              original={original}
              modified={modified}
              language={languageFor(selected)}
              theme="layera-dark"
              options={{
                readOnly: true,
                renderSideBySide: true,
                fontSize: 12,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              Select a file
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  record,
  files,
  onRevertAll,
}: {
  record: RunRecord;
  files: FileChange[];
  onRevertAll: () => void;
}) {
  const added = files.reduce((n, f) => n + f.added, 0);
  const deleted = files.reduce((n, f) => n + f.deleted, 0);
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
      <span className="min-w-0 truncate text-xs text-muted">
        {record.label || record.promptPreview || "Run"}
      </span>
      <span className="shrink-0 text-[10px] text-faint">
        {RUNNER_LABEL[record.runner]} · {formatDuration(record.durationMs)}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums">
        <span className="text-ok">+{added}</span>{" "}
        <span className="text-[#d47a5c]">−{deleted}</span>
      </span>
      {files.length > 0 && (
        <button
          type="button"
          onClick={onRevertAll}
          className="ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-[#d47a5c]"
        >
          Revert all
        </button>
      )}
    </div>
  );
}

function FileRow({
  file,
  active,
  reverted,
  onSelect,
  onRevert,
}: {
  file: FileChange;
  active: boolean;
  reverted: boolean;
  onSelect: () => void;
  onRevert: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 px-2 py-1 transition-colors ${
        active ? "bg-hover" : "hover:bg-hover"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
        title={file.path}
      >
        <span
          className={`block truncate text-[12px] ${
            reverted ? "text-faint line-through" : active ? "text-ink" : "text-muted"
          }`}
        >
          {file.path.split("/").pop()}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-faint">
          <span>{STATUS_LABEL[file.status] ?? file.status}</span>
          <span className="tabular-nums text-ok">+{file.added}</span>
          <span className="tabular-nums text-[#d47a5c]">−{file.deleted}</span>
        </span>
      </button>
      {!reverted && (
        <button
          type="button"
          onClick={onRevert}
          title="Discard this run's changes to this file"
          className="shrink-0 rounded px-1 text-[11px] text-faint opacity-0 transition-opacity focus-visible:opacity-100 hover:text-[#d47a5c] group-hover:opacity-100 group-focus-within:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}
