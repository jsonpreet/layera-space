import { useEffect, useRef, useState } from "react";
import {
  newCard,
  readBoard,
  writeBoard,
  type Board,
  type Card,
} from "../lib/board";
import { formatDuration } from "../lib/run";
import { useApp, type Pane } from "../store/app";
import { IconClose, IconPlus } from "./icons";

const SAVE_DEBOUNCE_MS = 500;

export function KanbanPane({ pane }: { pane: Pane }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const path = pane.boardPath;

  const runs = useApp((s) => s.runHistory[pane.workspaceId] ?? []);
  const openDiff = useApp((s) => s.openDiff);
  const refreshRunHistory = useApp((s) => s.refreshRunHistory);

  useEffect(() => {
    if (!path) return;
    void readBoard(path)
      .then(setBoard)
      .catch((e: unknown) => setError(String(e)));
    void refreshRunHistory(pane.workspaceId);
  }, [path, pane.workspaceId]);

  const commit = (next: Board) => {
    setBoard(next);
    if (!path) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void writeBoard(path, next).catch((e: unknown) => setError(String(e)));
    }, SAVE_DEBOUNCE_MS);
  };

  // Flush a pending save if the pane closes before the debounce fires.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
    },
    [],
  );

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        No board file for this workspace
      </div>
    );
  }
  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        {error ?? "Loading board…"}
      </div>
    );
  }

  const mutate = (fn: (b: Board) => void) => {
    const next = structuredClone(board);
    fn(next);
    commit(next);
  };

  const addCard = (col: number) => {
    const title = draft.trim();
    if (!title) {
      setAdding(null);
      return;
    }
    mutate((b) => b.columns[col].cards.push(newCard(title)));
    setDraft("");
  };

  const moveCard = (col: number, index: number, delta: number) => {
    const target = col + delta;
    if (target < 0 || target >= board.columns.length) return;
    mutate((b) => {
      const [card] = b.columns[col].cards.splice(index, 1);
      // Moving into the last column reads as completing the work.
      card.done = target === b.columns.length - 1;
      b.columns[target].cards.push(card);
    });
  };

  const reorder = (col: number, index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= board.columns[col].cards.length) return;
    mutate((b) => {
      const cards = b.columns[col].cards;
      [cards[index], cards[to]] = [cards[to], cards[index]];
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
        <span className="text-xs text-muted">Board</span>
        {error && (
          <span className="truncate text-[10px] text-[#d47a5c]">{error}</span>
        )}
        <button
          type="button"
          onClick={() =>
            mutate((b) => b.columns.push({ title: "Column", cards: [] }))
          }
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          Add column
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
        {board.columns.map((column, col) => (
          <div
            key={col}
            className="flex max-h-full min-w-[220px] flex-1 flex-col rounded border border-line bg-panel"
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
              <input
                value={column.title}
                onChange={(e) =>
                  mutate((b) => {
                    b.columns[col].title = e.target.value;
                  })
                }
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none"
                spellCheck={false}
              />
              <span className="shrink-0 text-[10px] tabular-nums text-faint">
                {column.cards.length}
              </span>
              <button
                type="button"
                title="Add card"
                onClick={() => {
                  setAdding(col);
                  setDraft("");
                }}
                className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-hover hover:text-ink"
              >
                <IconPlus />
              </button>
              {board.columns.length > 1 && (
                <button
                  type="button"
                  title="Delete column"
                  onClick={() => {
                    if (
                      column.cards.length > 0 &&
                      !window.confirm(
                        `Delete "${column.title}" and its ${column.cards.length} card(s)?`,
                      )
                    )
                      return;
                    mutate((b) => b.columns.splice(col, 1));
                  }}
                  className="shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-hover hover:text-[#d47a5c]"
                >
                  <IconClose />
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {adding === col && (
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => addCard(col)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      addCard(col);
                      setAdding(null);
                    }
                    if (e.key === "Escape") setAdding(null);
                  }}
                  placeholder="Card title"
                  rows={2}
                  className="mb-1.5 w-full resize-none rounded border border-accent/40 bg-base px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-faint"
                />
              )}

              {column.cards.map((card, index) => (
                <CardRow
                  key={card.id}
                  card={card}
                  first={index === 0}
                  last={index === column.cards.length - 1}
                  leftmost={col === 0}
                  rightmost={col === board.columns.length - 1}
                  run={runs.find((r) => r.runId === card.runId)}
                  onOpenRun={() =>
                    card.runId &&
                    openDiff(pane.workspaceId, card.runId, card.title)
                  }
                  onMove={(d) => moveCard(col, index, d)}
                  onReorder={(d) => reorder(col, index, d)}
                  onRename={(title) =>
                    mutate((b) => {
                      b.columns[col].cards[index].title = title;
                    })
                  }
                  onDelete={() =>
                    mutate((b) => b.columns[col].cards.splice(index, 1))
                  }
                />
              ))}

              {column.cards.length === 0 && adding !== col && (
                <p className="px-1 py-2 text-[11px] text-faint">No cards</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardRow({
  card,
  first,
  last,
  leftmost,
  rightmost,
  run,
  onOpenRun,
  onMove,
  onReorder,
  onRename,
  onDelete,
}: {
  card: Card;
  first: boolean;
  last: boolean;
  leftmost: boolean;
  rightmost: boolean;
  run?: { durationMs: number; filesChanged: unknown[]; status: string };
  onOpenRun: () => void;
  onMove: (delta: number) => void;
  onReorder: (delta: number) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="group mb-1.5 rounded border border-line bg-raised px-2 py-1.5">
      {editing ? (
        <textarea
          autoFocus
          defaultValue={card.title}
          rows={2}
          onBlur={(e) => {
            onRename(e.target.value.trim() || card.title);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full resize-none bg-transparent text-[12px] text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setEditing(true)}
          className={`w-full text-left text-[12px] leading-snug ${
            card.done ? "text-faint line-through" : "text-ink"
          }`}
          title="Double-click to edit"
        >
          {card.title}
        </button>
      )}

      {card.body && (
        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-faint">
          {card.body}
        </p>
      )}

      {card.runId && (
        <button
          type="button"
          onClick={onOpenRun}
          className="mt-1.5 flex w-full items-center gap-1.5 text-[10px] text-muted transition-colors hover:text-accent"
        >
          <span className="tabular-nums">run {card.runId.slice(0, 6)}</span>
          {run && <span className="text-faint">{formatDuration(run.durationMs)}</span>}
          {run && run.filesChanged.length > 0 && (
            <span className="text-faint">
              {run.filesChanged.length} file
              {run.filesChanged.length === 1 ? "" : "s"}
            </span>
          )}
        </button>
      )}

      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
        <CardBtn label="Move left" disabled={leftmost} onClick={() => onMove(-1)}>
          ←
        </CardBtn>
        <CardBtn label="Move right" disabled={rightmost} onClick={() => onMove(1)}>
          →
        </CardBtn>
        <CardBtn label="Move up" disabled={first} onClick={() => onReorder(-1)}>
          ↑
        </CardBtn>
        <CardBtn label="Move down" disabled={last} onClick={() => onReorder(1)}>
          ↓
        </CardBtn>
        <button
          type="button"
          title="Delete card"
          onClick={onDelete}
          className="ml-auto rounded px-1 text-[11px] text-faint transition-colors hover:bg-hover hover:text-[#d47a5c]"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function CardBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-1 text-[11px] text-faint transition-colors hover:bg-hover hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
