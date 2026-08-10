import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MEMORY_DIRS, type Note } from "../../lib/memory";
import { useApp, type Pane } from "../../store/app";
import { MemoryGraph } from "./MemoryGraph";

function relTime(seconds: number): string {
  if (!seconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function MemoryPane({ pane }: { pane: Pane }) {
  const workspaceId = pane.workspaceId;
  const ws = useApp((s) => s.workspaces.find((w) => w.id === workspaceId));
  const notes = useApp((s) => s.notes[workspaceId] ?? []);
  const { initMemory, refreshNotes, saveNote, deleteNote, updatePane } = useApp();

  const [dir, setDir] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(pane.notePath ?? null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [view, setView] = useState<"note" | "graph">("note");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void initMemory(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (!selected) {
      setContent("");
      setSaved("");
      return;
    }
    const note = notes.find((n) => n.rel === selected);
    if (!note) return;
    void invoke<string>("fs_read_text", { path: note.path })
      .then((text) => {
        setContent(text);
        setSaved(text);
      })
      .catch(() => setStatus("Could not open that note"));
    updatePane(pane.id, { notePath: selected });
  }, [selected, notes.length]);

  const dirty = content !== saved;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (dir && n.dir !== dir) return false;
      if (!needle) return true;
      return (
        n.title.toLowerCase().includes(needle) ||
        n.rel.toLowerCase().includes(needle) ||
        n.excerpt.toLowerCase().includes(needle)
      );
    });
  }, [notes, dir, query]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of notes) map.set(note.dir, (map.get(note.dir) ?? 0) + 1);
    return map;
  }, [notes]);

  const save = async () => {
    if (!selected) return;
    await saveNote(workspaceId, selected, content);
    setSaved(content);
    setStatus("Saved");
  };

  const create = async () => {
    const name = window.prompt("Note name");
    if (!name?.trim()) return;
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) return;
    const rel = `${dir ?? "context"}/${slug}.md`;
    await saveNote(workspaceId, rel, `# ${name.trim()}\n\n`);
    setSelected(rel);
    setView("note");
  };

  if (!ws?.folder) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-sm text-muted">No project folder</p>
        <p className="text-[11px] text-faint">
          Memory lives in the project as plain Markdown, so this workspace needs
          a folder first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter notes"
          className="h-5 w-40 rounded border border-line bg-base px-1.5 text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent/50"
          spellCheck={false}
        />
        {status && <span className="text-[10px] text-faint">{status}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView(view === "note" ? "graph" : "note")}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              view === "graph"
                ? "text-accent"
                : "text-faint hover:bg-hover hover:text-muted"
            }`}
          >
            Links
          </button>
          <button
            type="button"
            onClick={() => void create()}
            className="rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            New note
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => void save()}
              className="rounded bg-accent-deep px-2 py-0.5 text-[11px] text-ink transition-colors hover:bg-accent"
            >
              Save
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-32 shrink-0 overflow-y-auto border-r border-line bg-panel py-1">
          <DirRow
            label="All"
            count={notes.length}
            active={dir === null}
            onClick={() => setDir(null)}
          />
          {MEMORY_DIRS.map((d) => (
            <DirRow
              key={d}
              label={d}
              count={counts.get(d) ?? 0}
              active={dir === d}
              onClick={() => setDir(d)}
            />
          ))}
        </div>

        <div className="w-56 shrink-0 overflow-y-auto border-r border-line bg-panel py-1">
          {visible.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] text-faint">
              {notes.length === 0 ? "No notes yet" : "Nothing matches"}
            </p>
          )}
          {visible.map((note) => (
            <NoteRow
              key={note.rel}
              note={note}
              active={selected === note.rel}
              onSelect={() => {
                if (dirty && !window.confirm("Discard unsaved changes?")) return;
                setSelected(note.rel);
                setView("note");
              }}
              onDelete={async () => {
                if (!window.confirm(`Delete ${note.rel}?`)) return;
                await deleteNote(workspaceId, note.rel);
                if (selected === note.rel) setSelected(null);
              }}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {view === "graph" ? (
            <MemoryGraph
              notes={notes}
              selected={selected}
              onSelect={(rel) => {
                setSelected(rel);
                setView("note");
              }}
            />
          ) : selected ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void save();
                }
              }}
              spellCheck={false}
              className="h-full w-full resize-none bg-base p-3 text-[13px] leading-relaxed text-ink outline-none"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
              <p className="text-[13px] text-muted">Project memory</p>
              <p className="text-[11px] leading-relaxed text-faint">
                Notes here are handed to agents as context. Link them with
                [[double brackets]] and mention one in the composer with @name.
              </p>
              <button
                type="button"
                onClick={() => void refreshNotes(workspaceId)}
                className="mt-2 rounded px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-hover"
              >
                Rescan
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DirRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1 px-2.5 py-1 text-left text-[12px] transition-colors hover:bg-hover ${
        active ? "bg-hover text-ink" : "text-muted"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="ml-auto text-[10px] tabular-nums text-faint">{count}</span>
    </button>
  );
}

function NoteRow({
  note,
  active,
  onSelect,
  onDelete,
}: {
  note: Note;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex items-start gap-1 px-2.5 py-1.5 transition-colors ${
        active ? "bg-hover" : "hover:bg-hover"
      }`}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span
          className={`block truncate text-[12px] ${active ? "text-ink" : "text-muted"}`}
        >
          {note.title}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-faint">
          <span>{relTime(note.modified)}</span>
          {note.links.length > 0 && <span>{note.links.length} links</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete note"
        className="shrink-0 rounded px-1 text-[11px] text-faint opacity-0 transition-opacity focus-visible:opacity-100 hover:text-[#d47a5c] group-hover:opacity-100 group-focus-within:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
