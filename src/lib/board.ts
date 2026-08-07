import { invoke } from "@tauri-apps/api/core";

export type Card = {
  id: string;
  title: string;
  done: boolean;
  /** Free text under the bullet, indented in the file. */
  body?: string;
  /** The run that produced or relates to this card. */
  runId?: string;
  /** A pane this card is working in. */
  paneId?: string;
};

export type Column = { title: string; cards: Card[] };
export type Board = { columns: Column[] };

export const DEFAULT_BOARD: Board = {
  columns: [
    { title: "Todo", cards: [] },
    { title: "Doing", cards: [] },
    { title: "Done", cards: [] },
  ],
};

const META = /<!--\s*(.*?)\s*-->/;

function parseMeta(raw: string): Pick<Card, "id" | "runId" | "paneId"> {
  const match = raw.match(META);
  const out: Pick<Card, "id" | "runId" | "paneId"> = { id: "" };
  if (!match) return out;
  for (const token of match[1].split(/\s+/)) {
    const [key, value] = token.split(":");
    if (!value) continue;
    if (key === "id") out.id = value;
    else if (key === "run") out.runId = value;
    else if (key === "pane") out.paneId = value;
  }
  return out;
}

function serializeMeta(card: Card): string {
  const parts = [`id:${card.id}`];
  if (card.runId) parts.push(`run:${card.runId}`);
  if (card.paneId) parts.push(`pane:${card.paneId}`);
  return ` <!-- ${parts.join(" ")} -->`;
}

/**
 * Parse a board from Markdown.
 *
 * The format is a plain checklist under `##` headings, so the file stays
 * readable, diffable and editable outside the app; card metadata hides in an
 * HTML comment that renderers ignore.
 */
export function parseBoard(text: string): Board {
  const columns: Column[] = [];
  let current: Column | null = null;
  let lastCard: Card | null = null;

  for (const raw of text.split("\n")) {
    const heading = raw.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      current = { title: heading[1], cards: [] };
      columns.push(current);
      lastCard = null;
      continue;
    }

    const bullet = raw.match(/^\s*-\s+\[([ xX])\]\s*(.*)$/);
    if (bullet && current) {
      const done = bullet[1].toLowerCase() === "x";
      const rest = bullet[2];
      const meta = parseMeta(rest);
      const title = rest.replace(META, "").trim();
      lastCard = {
        id: meta.id || crypto.randomUUID().slice(0, 8),
        title,
        done,
        runId: meta.runId,
        paneId: meta.paneId,
      };
      current.cards.push(lastCard);
      continue;
    }

    // Indented continuation lines form the card body.
    if (lastCard && /^\s{2,}\S/.test(raw)) {
      const line = raw.trim();
      lastCard.body = lastCard.body ? `${lastCard.body}\n${line}` : line;
      continue;
    }

    if (!raw.trim()) continue;
    // Anything else (a title line, prose) ends the current card's body.
    lastCard = null;
  }

  return columns.length > 0 ? { columns } : structuredClone(DEFAULT_BOARD);
}

export function serializeBoard(board: Board): string {
  const out: string[] = ["# Board", ""];
  for (const column of board.columns) {
    out.push(`## ${column.title}`, "");
    for (const card of column.cards) {
      out.push(`- [${card.done ? "x" : " "}] ${card.title}${serializeMeta(card)}`);
      if (card.body) {
        for (const line of card.body.split("\n")) out.push(`  ${line}`);
      }
    }
    out.push("");
  }
  // Exactly one trailing newline, so repeated saves don't grow the file.
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

export function newCard(title: string, extra: Partial<Card> = {}): Card {
  return {
    id: crypto.randomUUID().slice(0, 8),
    title,
    done: false,
    ...extra,
  };
}

export async function readBoard(path: string): Promise<Board> {
  try {
    const text = await invoke<string>("fs_read_text", { path });
    return parseBoard(text);
  } catch {
    return structuredClone(DEFAULT_BOARD);
  }
}

export async function writeBoard(path: string, board: Board): Promise<void> {
  await invoke("fs_write_text", { path, content: serializeBoard(board) });
}

/** Append cards to the first column — where a generated plan lands. */
export async function addCardsToBoard(
  path: string,
  titles: string[],
  extra: Partial<Card> = {},
): Promise<Board> {
  const board = await readBoard(path);
  if (board.columns.length === 0) board.columns.push({ title: "Todo", cards: [] });
  board.columns[0].cards.push(...titles.map((t) => newCard(t, extra)));
  await writeBoard(path, board);
  return board;
}

type LegacyBoard = {
  columns?: { id?: string; title?: string; cards?: { id?: string; title?: string }[] }[];
};

/**
 * Convert a pre-Markdown JSON board, if one is sitting next to the new path.
 * The original is renamed rather than deleted.
 */
export async function migrateLegacyBoard(mdPath: string): Promise<boolean> {
  const jsonPath = mdPath.replace(/board\.md$/, "board.json");
  if (jsonPath === mdPath) return false;
  const [hasMd, hasJson] = await Promise.all([
    invoke<boolean>("fs_exists", { path: mdPath }),
    invoke<boolean>("fs_exists", { path: jsonPath }),
  ]);
  if (hasMd || !hasJson) return false;

  try {
    const raw = await invoke<string>("fs_read_text", { path: jsonPath });
    const legacy = JSON.parse(raw) as LegacyBoard;
    const board: Board = {
      columns: (legacy.columns ?? []).map((c) => ({
        title: c.title || "Column",
        cards: (c.cards ?? []).map((card) => ({
          id: card.id?.slice(0, 8) || crypto.randomUUID().slice(0, 8),
          title: card.title ?? "",
          // The JSON board had no done flag; the Done column implied it.
          done: (c.title ?? "").toLowerCase() === "done",
        })),
      })),
    };
    if (board.columns.length === 0) return false;
    await writeBoard(mdPath, board);
    await invoke("fs_rename", { from: jsonPath, to: `${jsonPath}.bak` });
    return true;
  } catch {
    return false;
  }
}
