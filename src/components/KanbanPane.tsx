import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../store/app";

type Card = { id: string; title: string };
type Column = { id: string; title: string; cards: Card[] };
type Board = { columns: Column[] };

const DEFAULT_BOARD: Board = {
  columns: [
    { id: "todo", title: "Todo", cards: [] },
    { id: "doing", title: "Doing", cards: [] },
    { id: "done", title: "Done", cards: [] },
  ],
};

export function KanbanPane({ pane }: { pane: Pane }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const boardRef = useRef<Board | null>(null);
  boardRef.current = board;

  useEffect(() => {
    if (!pane.boardPath) return;
    invoke<string>("fs_read_text", { path: pane.boardPath })
      .then((raw) => {
        try {
          const parsed = JSON.parse(raw) as Board;
          if (Array.isArray(parsed.columns)) setBoard(parsed);
          else setBoard(DEFAULT_BOARD);
        } catch {
          setBoard(DEFAULT_BOARD);
        }
      })
      .catch(() => setBoard(DEFAULT_BOARD));
  }, [pane.boardPath]);

  const save = useCallback(
    (b: Board) => {
      if (!pane.boardPath) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void invoke("fs_write_text", {
          path: pane.boardPath!,
          content: JSON.stringify(b, null, 2),
        });
      }, 500);
    },
    [pane.boardPath],
  );

  const update = (b: Board) => {
    setBoard(b);
    save(b);
  };

  const moveCard = (colId: string, cardId: string, dx: number) => {
    if (!board) return;
    const idx = board.columns.findIndex((c) => c.id === colId);
    const target = board.columns[idx + dx];
    if (!target) return;
    const cols = board.columns.map((c) => ({ ...c, cards: [...c.cards] }));
    const card = cols[idx].cards.find((x) => x.id === cardId);
    if (!card) return;
    cols[idx].cards = cols[idx].cards.filter((x) => x.id !== cardId);
    cols[idx + dx].cards.push(card);
    update({ columns: cols });
  };

  const deleteCard = (colId: string, cardId: string) => {
    if (!board) return;
    update({
      columns: board.columns.map((c) =>
        c.id === colId ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) } : c,
      ),
    });
  };

  const renameCard = (colId: string, cardId: string, title: string) => {
    if (!board) return;
    const t = title.trim();
    if (!t) return deleteCard(colId, cardId);
    update({
      columns: board.columns.map((c) =>
        c.id === colId
          ? { ...c, cards: c.cards.map((x) => (x.id === cardId ? { ...x, title: t } : x)) }
          : c,
      ),
    });
  };

  const addCard = (colId: string, title: string) => {
    if (!board) return;
    const t = title.trim();
    if (!t) return;
    update({
      columns: board.columns.map((c) =>
        c.id === colId
          ? { ...c, cards: [...c.cards, { id: crypto.randomUUID(), title: t }] }
          : c,
      ),
    });
  };

  const addColumn = () => {
    if (!board) return;
    update({
      columns: [
        ...board.columns,
        { id: crypto.randomUUID(), title: "Column", cards: [] },
      ],
    });
  };

  const deleteColumn = (colId: string) => {
    if (!board) return;
    update({ columns: board.columns.filter((c) => c.id !== colId) });
  };

  const renameColumn = (colId: string, title: string) => {
    if (!board) return;
    const t = title.trim();
    if (!t) return;
    update({
      columns: board.columns.map((c) => (c.id === colId ? { ...c, title: t } : c)),
    });
  };

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Loading board…
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto bg-base p-3">
      {board.columns.map((col, ci) => (
        <div
          key={col.id}
          className="flex h-full w-[250px] shrink-0 flex-col rounded-lg border border-line bg-panel"
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            {editing === `col-${col.id}` ? (
              <input
                autoFocus
                defaultValue={col.title}
                onBlur={(e) => {
                  renameColumn(col.id, e.target.value);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-full rounded border border-accent/60 bg-base px-1 py-0.5 text-xs text-ink outline-none"
              />
            ) : (
              <button
                onClick={() => setEditing(`col-${col.id}`)}
                className="truncate text-xs font-medium text-ink"
              >
                {col.title}
              </button>
            )}
            <span className="text-[10px] text-faint">{col.cards.length}</span>
            <button
              onClick={() => deleteColumn(col.id)}
              className="ml-auto rounded p-0.5 text-faint transition-colors hover:text-[#d47a5c]"
              title="Delete column"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {col.cards.map((card) => (
              <div
                key={card.id}
                className="group mb-2 rounded-md border border-line bg-raised px-2.5 py-2"
              >
                {editing === card.id ? (
                  <input
                    autoFocus
                    defaultValue={card.title}
                    onBlur={(e) => {
                      renameCard(col.id, card.id, e.target.value);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="w-full rounded border border-accent/60 bg-base px-1 py-0.5 text-xs text-ink outline-none"
                  />
                ) : (
                  <div
                    className="cursor-default text-xs text-ink"
                    onDoubleClick={() => setEditing(card.id)}
                  >
                    {card.title}
                  </div>
                )}
                <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => moveCard(col.id, card.id, -1)}
                    disabled={ci === 0}
                    className="rounded px-1 text-[10px] text-faint hover:bg-hover hover:text-ink disabled:opacity-30"
                    title="Move left"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => moveCard(col.id, card.id, 1)}
                    disabled={ci === board.columns.length - 1}
                    className="rounded px-1 text-[10px] text-faint hover:bg-hover hover:text-ink disabled:opacity-30"
                    title="Move right"
                  >
                    →
                  </button>
                  <button
                    onClick={() => deleteCard(col.id, card.id)}
                    className="ml-auto rounded px-1 text-[10px] text-faint hover:bg-hover hover:text-[#d47a5c]"
                    title="Delete card"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {addingIn === col.id ? (
              <input
                autoFocus
                placeholder="Task title…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addCard(col.id, (e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                  if (e.key === "Escape") setAddingIn(null);
                }}
                onBlur={() => setAddingIn(null)}
                className="w-full rounded border border-accent/60 bg-base px-2 py-1.5 text-xs text-ink outline-none"
              />
            ) : (
              <button
                onClick={() => setAddingIn(col.id)}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-faint transition-colors hover:bg-hover hover:text-muted"
              >
                + Add card
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        onClick={addColumn}
        className="flex h-full w-[250px] shrink-0 items-start justify-center rounded-lg border border-dashed border-line pt-3 text-xs text-faint transition-colors hover:border-accent/40 hover:text-muted"
      >
        + Add column
      </button>
    </div>
  );
}
