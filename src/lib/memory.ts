import { invoke } from "@tauri-apps/api/core";
import type { ContextBlock } from "./run";

export type Note = {
  path: string;
  rel: string;
  dir: string;
  name: string;
  title: string;
  links: string[];
  modified: number;
  size: number;
  excerpt: string;
};

export type SearchHit = {
  rel: string;
  title: string;
  line: number;
  text: string;
};

export const MEMORY_DIRS = [
  "context",
  "tasks",
  "handoffs",
  "decisions",
  "bugs",
] as const;

export function memoryInit(folder: string): Promise<string> {
  return invoke<string>("memory_init", { folder });
}

export function memoryIndex(folder: string): Promise<Note[]> {
  return invoke<Note[]>("memory_index", { folder });
}

export function memoryWrite(
  folder: string,
  rel: string,
  content: string,
): Promise<string> {
  return invoke<string>("memory_write", { folder, rel, content });
}

export function memoryDelete(folder: string, rel: string): Promise<void> {
  return invoke("memory_delete", { folder, rel });
}

export function memorySearch(
  folder: string,
  query: string,
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("memory_search", { folder, query });
}

/** Wiki-links match on the note's file name, case-insensitively. */
function bySlug(notes: Note[]): Map<string, Note> {
  const map = new Map<string, Note>();
  for (const note of notes) {
    map.set(note.name.toLowerCase(), note);
    map.set(note.title.toLowerCase(), note);
  }
  return map;
}

/** Notes named explicitly in the prompt with `@note`. */
export function mentionedNotes(prompt: string, notes: Note[]): Note[] {
  const map = bySlug(notes);
  const found: Note[] = [];
  for (const match of prompt.matchAll(/@([\w./-]+)/g)) {
    const note = map.get(match[1].toLowerCase());
    if (note && !found.includes(note)) found.push(note);
  }
  return found;
}

export type SelectionOptions = {
  /** Directories eligible for the recency pass. */
  dirs?: string[];
  maxChars?: number;
  /** Include notes linked from the ones explicitly mentioned. */
  followLinks?: boolean;
};

export type Selection = {
  notes: Note[];
  reasons: Map<string, "mentioned" | "linked" | "recent">;
  totalChars: number;
  truncated: boolean;
};

const DEFAULT_MAX_CHARS = 12000;

/**
 * Choose which notes to inject.
 *
 * Deliberately deterministic and explainable — mentions first, then their
 * wiki-link neighbours, then recency — rather than an embedding search. The
 * composer shows exactly what was selected and why, which matters more here
 * than relevance ranking, and it costs nothing to run.
 */
export function selectContext(
  prompt: string,
  notes: Note[],
  options: SelectionOptions = {},
): Selection {
  const {
    dirs = [...MEMORY_DIRS],
    maxChars = DEFAULT_MAX_CHARS,
    followLinks = true,
  } = options;

  const reasons = new Map<string, "mentioned" | "linked" | "recent">();
  const picked: Note[] = [];
  const map = bySlug(notes);

  const take = (note: Note, why: "mentioned" | "linked" | "recent") => {
    if (reasons.has(note.rel)) return;
    reasons.set(note.rel, why);
    picked.push(note);
  };

  for (const note of mentionedNotes(prompt, notes)) take(note, "mentioned");

  if (followLinks) {
    // One hop only: a note's immediate neighbours are usually relevant, but
    // following the whole graph would drag in the entire vault.
    for (const note of [...picked]) {
      for (const link of note.links) {
        const target = map.get(link.toLowerCase());
        if (target) take(target, "linked");
      }
    }
  }

  const eligible = notes
    .filter((n) => dirs.includes(n.dir))
    .sort((a, b) => b.modified - a.modified);
  for (const note of eligible) take(note, "recent");

  // Trim to the budget, keeping the highest-priority notes.
  const kept: Note[] = [];
  let total = 0;
  let truncated = false;
  for (const note of picked) {
    if (total + note.size > maxChars) {
      truncated = true;
      continue;
    }
    total += note.size;
    kept.push(note);
  }
  for (const note of picked) {
    if (!kept.includes(note)) reasons.delete(note.rel);
  }

  return { notes: kept, reasons, totalChars: total, truncated };
}

export async function toContextBlocks(notes: Note[]): Promise<ContextBlock[]> {
  const blocks: ContextBlock[] = [];
  for (const note of notes) {
    try {
      const content = await invoke<string>("fs_read_text", { path: note.path });
      blocks.push({ label: `memory/${note.rel}`, content });
    } catch {
      // A note deleted between indexing and sending is simply skipped.
    }
  }
  return blocks;
}

/** Build the handoff a completed run leaves for whatever runs next. */
export function handoffNote(input: {
  label: string;
  runner: string;
  summary?: string | null;
  files: { path: string; status: string }[];
  when: number;
}): { rel: string; content: string } {
  const stamp = new Date(input.when).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug =
    input.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "run";

  const lines = [
    `# ${input.label}`,
    "",
    `Run by ${input.runner} on ${new Date(input.when).toLocaleString()}.`,
    "",
    "## What changed",
    "",
  ];
  if (input.files.length === 0) {
    lines.push("No files were changed.");
  } else {
    for (const file of input.files) lines.push(`- \`${file.path}\` (${file.status})`);
  }
  if (input.summary?.trim()) {
    lines.push("", "## Summary", "", input.summary.trim());
  }
  lines.push("", "## Next", "", "- ");

  return { rel: `handoffs/${stamp}-${slug}.md`, content: `${lines.join("\n")}\n` };
}
