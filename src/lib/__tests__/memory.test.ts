import { describe, expect, it } from "vitest";
import { handoffNote, mentionedNotes, selectContext, type Note } from "../memory";

function note(partial: Partial<Note> & { name: string }): Note {
  return {
    path: `/vault/${partial.dir ?? "context"}/${partial.name}.md`,
    rel: `${partial.dir ?? "context"}/${partial.name}.md`,
    dir: partial.dir ?? "context",
    name: partial.name,
    title: partial.title ?? partial.name,
    links: partial.links ?? [],
    modified: partial.modified ?? 0,
    size: partial.size ?? 100,
    excerpt: "",
  };
}

const NOTES: Note[] = [
  note({ name: "architecture", links: ["parser"], modified: 300 }),
  note({ name: "parser", links: [], modified: 200 }),
  note({ name: "unrelated", modified: 100 }),
  note({ name: "old-bug", dir: "bugs", modified: 50 }),
];

describe("mentionedNotes", () => {
  it("finds notes named with @", () => {
    expect(mentionedNotes("look at @architecture please", NOTES).map((n) => n.name)).toEqual([
      "architecture",
    ]);
  });

  it("matches case-insensitively and ignores unknown names", () => {
    expect(mentionedNotes("@ARCHITECTURE and @nope", NOTES).map((n) => n.name)).toEqual([
      "architecture",
    ]);
  });

  it("does not repeat a note mentioned twice", () => {
    expect(mentionedNotes("@parser @parser", NOTES)).toHaveLength(1);
  });
});

describe("selectContext", () => {
  it("puts explicitly mentioned notes first and says why", () => {
    const selection = selectContext("check @architecture", NOTES);
    expect(selection.notes[0].name).toBe("architecture");
    expect(selection.reasons.get("context/architecture.md")).toBe("mentioned");
  });

  it("follows wiki-links one hop from a mention", () => {
    const selection = selectContext("check @architecture", NOTES);
    expect(selection.reasons.get("context/parser.md")).toBe("linked");
  });

  it("does not follow links when told not to", () => {
    const selection = selectContext("check @architecture", NOTES, {
      followLinks: false,
      dirs: [],
    });
    expect(selection.notes.map((n) => n.name)).toEqual(["architecture"]);
  });

  it("fills the rest by recency within the chosen directories", () => {
    const selection = selectContext("nothing mentioned", NOTES, { dirs: ["context"] });
    expect(selection.notes.map((n) => n.name)).toEqual([
      "architecture",
      "parser",
      "unrelated",
    ]);
    expect(selection.notes.every((n) => n.dir === "context")).toBe(true);
  });

  it("respects the character budget and reports truncation", () => {
    const big = [
      note({ name: "a", size: 8000, modified: 3 }),
      note({ name: "b", size: 8000, modified: 2 }),
    ];
    const selection = selectContext("x", big, { maxChars: 10000 });
    expect(selection.notes).toHaveLength(1);
    expect(selection.truncated).toBe(true);
    expect(selection.totalChars).toBe(8000);
  });

  it("keeps a mention even when recency would have filled the budget first", () => {
    const notes = [
      note({ name: "recent", size: 9000, modified: 999 }),
      note({ name: "wanted", size: 500, modified: 1 }),
    ];
    const selection = selectContext("@wanted", notes, { maxChars: 1000 });
    expect(selection.notes.map((n) => n.name)).toEqual(["wanted"]);
  });

  it("drops the reason for any note trimmed by the budget", () => {
    const notes = [note({ name: "a", size: 5000 }), note({ name: "b", size: 5000 })];
    const selection = selectContext("x", notes, { maxChars: 6000 });
    expect(selection.reasons.size).toBe(selection.notes.length);
  });

  it("returns nothing when there are no notes", () => {
    const selection = selectContext("anything", []);
    expect(selection.notes).toEqual([]);
    expect(selection.totalChars).toBe(0);
  });

  it("is deterministic across calls", () => {
    const a = selectContext("@architecture", NOTES);
    const b = selectContext("@architecture", NOTES);
    expect(a.notes.map((n) => n.rel)).toEqual(b.notes.map((n) => n.rel));
  });
});

describe("handoffNote", () => {
  const when = Date.UTC(2026, 0, 2, 3, 4, 5);

  it("writes into handoffs/ with a sortable, slugged name", () => {
    const { rel } = handoffNote({
      label: "Fix the stream parser!",
      runner: "claude",
      files: [],
      when,
    });
    expect(rel.startsWith("handoffs/2026-01-02")).toBe(true);
    expect(rel.endsWith("fix-the-stream-parser.md")).toBe(true);
  });

  it("lists the changed files", () => {
    const { content } = handoffNote({
      label: "x",
      runner: "codex",
      files: [{ path: "src/a.ts", status: "M" }],
      when,
    });
    expect(content).toContain("`src/a.ts` (M)");
  });

  it("says so plainly when nothing changed", () => {
    const { content } = handoffNote({ label: "x", runner: "codex", files: [], when });
    expect(content).toContain("No files were changed.");
  });

  it("omits the summary section when there is no summary", () => {
    const { content } = handoffNote({
      label: "x",
      runner: "codex",
      files: [],
      when,
      summary: "   ",
    });
    expect(content).not.toContain("## Summary");
  });

  it("falls back to a usable name when the label has no word characters", () => {
    const { rel } = handoffNote({ label: "!!!", runner: "c", files: [], when });
    expect(rel.endsWith("-run.md")).toBe(true);
  });
});
