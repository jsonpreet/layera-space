import { useEffect, useState } from "react";
import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../store/app";
import { useApp } from "../store/app";

type HeadFile = { tracked: boolean; in_repo: boolean; content: string };

loader.config({ monaco });

monaco.editor.defineTheme("layera-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#16130f",
    "editor.foreground": "#ece5da",
    "editorLineNumber.foreground": "#6b6156",
    "editorLineNumber.activeForeground": "#c98f52",
    "editor.selectionBackground": "#3a3226",
    "editor.lineHighlightBackground": "#1d1915",
  },
});

type FsEntry = {
  name: string;
  path: string;
  is_dir: boolean;
};

type FileTreeProps = {
  entries: FsEntry[];
  directories: Record<string, FsEntry[]>;
  expanded: Record<string, boolean>;
  selectedPath: string | null;
  onToggle: (entry: FsEntry) => void;
  onSelect: (entry: FsEntry) => void;
};

function FileTree({
  entries,
  directories,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
}: FileTreeProps) {
  return (
    <div>
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() => (entry.is_dir ? onToggle(entry) : onSelect(entry))}
            className={`flex w-full items-center gap-1.5 truncate px-2 py-1 text-left text-[12px] transition-colors hover:bg-hover ${
              selectedPath === entry.path
                ? "bg-hover text-ink"
                : "text-muted"
            }`}
            title={entry.path}
          >
            <span className="w-3 shrink-0 text-center text-[10px] text-faint">
              {entry.is_dir ? (expanded[entry.path] ? "v" : ">") : ""}
            </span>
            <span className="truncate">{entry.name}</span>
          </button>
          {entry.is_dir && expanded[entry.path] && (
            <div className="ml-3 border-l border-line pl-1">
              <FileTree
                entries={directories[entry.path] ?? []}
                directories={directories}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescript";
    case "js":
      return "javascript";
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "md":
      return "markdown";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "sh":
      return "shell";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return "plaintext";
  }
}

export function EditorPane({ pane }: { pane: Pane }) {
  const workspace = useApp((s) =>
    s.workspaces.find((workspace) => workspace.id === pane.workspaceId),
  );
  const updatePane = useApp((s) => s.updatePane);
  const rootPath = workspace?.folder ?? null;
  const [directories, setDirectories] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(
    pane.filePath ?? null,
  );
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [tracked, setTracked] = useState(false);
  const [diff, setDiff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = content !== savedContent;

  const loadDirectory = (path: string) => {
    void invoke<FsEntry[]>("fs_list_dir", { path })
      .then((entries) => {
        setDirectories((current) => ({ ...current, [path]: entries }));
        setTreeError(null);
      })
      .catch((error: unknown) => {
        setTreeError(String(error));
      });
  };

  useEffect(() => {
    setDirectories({});
    setExpanded(rootPath ? { [rootPath]: true } : {});
    setTreeError(null);
    if (rootPath) loadDirectory(rootPath);
  }, [rootPath]);

  useEffect(() => {
    if (!selectedPath || !rootPath) return;
    if (!selectedPath.startsWith(rootPath)) {
      setSelectedPath(null);
      return;
    }
    setLoading(true);
    void invoke<string>("fs_read_text", { path: selectedPath })
      .then((text) => {
        setContent(text);
        setSavedContent(text);
        setOriginalContent("");
        setDiff(false);
        setMessage(null);
      })
      .catch((error: unknown) => {
        setMessage(`Could not open file: ${String(error)}`);
        setSelectedPath(null);
        updatePane(pane.id, { filePath: undefined });
      })
      .finally(() => setLoading(false));
  }, [rootPath, selectedPath]);

  const selectEntry = (entry: FsEntry) => {
    if (dirty && entry.path !== selectedPath) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    setSelectedPath(entry.path);
    updatePane(pane.id, { filePath: entry.path });
  };

  const toggleDirectory = (entry: FsEntry) => {
    const open = !expanded[entry.path];
    setExpanded((current) => ({ ...current, [entry.path]: open }));
    if (open && !directories[entry.path]) loadDirectory(entry.path);
  };

  const writeContent = (nextContent: string, successMessage: string) => {
    if (!selectedPath) return;
    setMessage("Saving...");
    void invoke("fs_write_text", { path: selectedPath, content: nextContent })
      .then(() => {
        setContent(nextContent);
        setSavedContent(nextContent);
        setDiff(false);
        setMessage(successMessage);
      })
      .catch((error: unknown) => setMessage(`Save failed: ${String(error)}`));
  };

  const save = () => writeContent(content, "Saved");

  const toggleDiff = () => {
    if (!selectedPath) return;
    if (diff) {
      setDiff(false);
      return;
    }
    setMessage("Loading HEAD...");
    void invoke<HeadFile>("fs_git_head_state", { path: selectedPath })
      .then((head) => {
        setOriginalContent(head.content);
        setTracked(head.tracked);
        setDiff(true);
        setMessage(
          head.tracked
            ? null
            : head.in_repo
              ? "New file — nothing committed yet, so the left side is empty"
              : "Not a git repository; showing an empty base",
        );
      })
      .catch((error: unknown) =>
        setMessage(`Could not load HEAD: ${String(error)}`),
      );
  };

  const acceptDiff = () => writeContent(content, "Accepted working copy");

  const rejectDiff = () => {
    if (!selectedPath) return;
    // Without a committed version there is nothing to restore. Writing the
    // empty base back would silently truncate the file to zero bytes, so offer
    // the only honest alternative instead.
    if (!tracked) {
      if (
        !window.confirm(
          `${fileName(selectedPath)} has no committed version to restore.\n\nDelete the file instead?`,
        )
      ) {
        return;
      }
      void invoke("fs_delete", { path: selectedPath })
        .then(() => {
          setSelectedPath(null);
          setContent("");
          setSavedContent("");
          setDiff(false);
          setMessage("Deleted");
        })
        .catch((error: unknown) => setMessage(`Delete failed: ${String(error)}`));
      return;
    }
    if (!window.confirm("Replace the working file with its HEAD version?")) {
      return;
    }
    writeContent(originalContent, "Restored HEAD");
  };

  const entries = rootPath ? directories[rootPath] ?? [] : [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {selectedPath ? fileName(selectedPath) : workspace?.title ?? "Editor"}
          {dirty && <span className="ml-1 text-accent">*</span>}
        </span>
        {message && (
          <span className="max-w-[260px] truncate text-[10px] text-faint">
            {message}
          </span>
        )}
        {diff ? (
          <>
            <button
              type="button"
              onClick={acceptDiff}
              disabled={!selectedPath}
              className="rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={rejectDiff}
              disabled={!selectedPath}
              className="rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-[#d47a5c] disabled:opacity-40"
            >
              Reject
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={!selectedPath || !dirty}
            className="rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            Save
          </button>
        )}
        <button
          type="button"
          onClick={toggleDiff}
          disabled={!selectedPath || loading}
          className={`rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
            diff
              ? "bg-hover text-accent"
              : "text-muted hover:bg-hover hover:text-ink"
          }`}
        >
          {diff ? "Editor" : "Diff"}
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="w-52 shrink-0 overflow-auto border-r border-line bg-panel py-2">
          <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.12em] text-faint">
            {rootPath ? fileName(rootPath) : "Project"}
          </div>
          {!rootPath ? (
            <p className="px-3 text-xs leading-5 text-faint">
              Choose a project folder above to browse files.
            </p>
          ) : treeError ? (
            <p className="px-3 text-xs leading-5 text-[#d47a5c]">{treeError}</p>
          ) : (
            <FileTree
              entries={entries}
              directories={directories}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={toggleDirectory}
              onSelect={selectEntry}
            />
          )}
        </aside>

        <main className="min-h-0 min-w-0 flex-1">
          {!rootPath ? (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              No project folder selected
            </div>
          ) : !selectedPath ? (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              Select a file from the project tree
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              Loading {fileName(selectedPath)}...
            </div>
          ) : diff ? (
            <DiffEditor
              height="100%"
              theme="layera-dark"
              language={languageFor(selectedPath)}
              original={originalContent}
              modified={content}
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                readOnly: true,
                renderSideBySide: true,
                fontSize: 13,
                lineNumbers: "on",
              }}
            />
          ) : (
            <Editor
              height="100%"
              theme="layera-dark"
              language={languageFor(selectedPath)}
              value={content}
              onChange={(value) => setContent(value ?? "")}
              onMount={(editor) => editor.focus()}
              loading={
                <div className="flex h-full items-center justify-center text-sm text-faint">
                  Loading editor...
                </div>
              }
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily:
                  'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
                padding: { top: 10 },
                scrollBeyondLastLine: false,
                tabSize: 2,
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
