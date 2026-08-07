import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard, type Board } from "../board";

/** Round-tripping is the property that matters: a lossy board eats real work. */
function roundTrip(md: string): string {
  return serializeBoard(parseBoard(md));
}

const FULL = `# Board

## Todo

- [ ] Fix the stream parser <!-- id:8f2a run:9c1b -->
- [ ] Wire the rail <!-- id:1d0e pane:44c8 -->

## Doing

- [ ] Ship replay <!-- id:77aa -->
  Notes indented under the bullet become the card body.
  A second line too.

## Done

- [x] Baseline commit <!-- id:0001 -->
`;

describe("parseBoard", () => {
  it("reads columns, cards, state and metadata", () => {
    const board = parseBoard(FULL);
    expect(board.columns.map((c) => c.title)).toEqual(["Todo", "Doing", "Done"]);
    expect(board.columns[0].cards[0]).toMatchObject({
      id: "8f2a",
      title: "Fix the stream parser",
      done: false,
      runId: "9c1b",
    });
    expect(board.columns[0].cards[1].paneId).toBe("44c8");
    expect(board.columns[2].cards[0].done).toBe(true);
  });

  it("keeps multi-line bodies attached to their card", () => {
    const card = parseBoard(FULL).columns[1].cards[0];
    expect(card.body).toBe(
      "Notes indented under the bullet become the card body.\nA second line too.",
    );
  });

  it("keeps empty columns rather than dropping them", () => {
    const board = parseBoard("## Todo\n\n## Doing\n\n## Done\n");
    expect(board.columns).toHaveLength(3);
    expect(board.columns[1].cards).toEqual([]);
  });

  it("falls back to the default board for empty or junk input", () => {
    expect(parseBoard("").columns.map((c) => c.title)).toEqual([
      "Todo",
      "Doing",
      "Done",
    ]);
    expect(parseBoard("just some prose").columns).toHaveLength(3);
  });

  it("gives an id to a card written by hand without one", () => {
    const card = parseBoard("## Todo\n- [ ] typed straight into the file\n")
      .columns[0].cards[0];
    expect(card.title).toBe("typed straight into the file");
    expect(card.id).toMatch(/\S/);
  });

  it("accepts an uppercase X as done", () => {
    expect(parseBoard("## Done\n- [X] shipped <!-- id:a1 -->\n").columns[0].cards[0].done).toBe(true);
  });
});

describe("serializeBoard", () => {
  it("round-trips a full board unchanged", () => {
    expect(roundTrip(FULL)).toBe(FULL);
  });

  it("is stable across repeated saves", () => {
    const once = roundTrip(FULL);
    expect(roundTrip(once)).toBe(once);
  });

  it("ends with exactly one newline no matter how many the input had", () => {
    const out = roundTrip(`${FULL}\n\n\n`);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("survives titles containing brackets, dashes and unicode", () => {
    const md =
      "## Todo\n\n- [ ] Handle [square] brackets — and an em dash · ✅ <!-- id:zz -->\n";
    const card = parseBoard(md).columns[0].cards[0];
    expect(card.title).toBe("Handle [square] brackets — and an em dash · ✅");
    expect(roundTrip(md)).toBe("# Board\n\n" + md);
  });

  it("does not let a title swallow a following card", () => {
    const board = parseBoard(
      "## Todo\n- [ ] one <!-- id:a -->\n- [ ] two <!-- id:b -->\n",
    );
    expect(board.columns[0].cards.map((c) => c.title)).toEqual(["one", "two"]);
  });

  it("writes an empty board without crashing", () => {
    const empty: Board = { columns: [] };
    expect(serializeBoard(empty)).toBe("# Board\n");
  });
});
