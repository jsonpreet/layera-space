import { describe, expect, it } from "vitest";
import {
  collectLeaves,
  filterLayout,
  firstLeaf,
  insertSplit,
  removeLeaf,
  setRatioAt,
  type LayoutNode,
} from "../layout";

const leaf = (paneId: string): LayoutNode => ({ type: "leaf", paneId });

const split = (
  dir: "h" | "v",
  a: LayoutNode,
  b: LayoutNode,
  ratio = 0.5,
): LayoutNode => ({ type: "split", dir, ratio, children: [a, b] });

/** a | (b / c) — the shape produced by splitting right, then splitting down. */
const tree = () => split("h", leaf("a"), split("v", leaf("b"), leaf("c")));

describe("firstLeaf", () => {
  it("returns null for an empty layout", () => {
    expect(firstLeaf(null)).toBeNull();
  });

  it("finds the leftmost leaf", () => {
    expect(firstLeaf(tree())).toBe("a");
  });
});

describe("collectLeaves", () => {
  it("returns every pane id in order", () => {
    expect(collectLeaves(tree())).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for an empty layout", () => {
    expect(collectLeaves(null)).toEqual([]);
  });
});

describe("insertSplit", () => {
  it("replaces the target leaf with a split holding old and new", () => {
    const next = insertSplit(leaf("a"), "a", "h", "b");
    expect(collectLeaves(next)).toEqual(["a", "b"]);
    expect(next.type).toBe("split");
  });

  it("splits deep inside the tree without disturbing siblings", () => {
    const next = insertSplit(tree(), "c", "h", "d");
    expect(collectLeaves(next)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves the tree untouched when the target is missing", () => {
    const before = tree();
    expect(insertSplit(before, "nope", "h", "d")).toEqual(before);
  });

  it("does not mutate the input", () => {
    const before = tree();
    const snapshot = JSON.stringify(before);
    insertSplit(before, "a", "v", "z");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("removeLeaf", () => {
  it("collapses the split and promotes the surviving sibling", () => {
    const next = removeLeaf(tree(), "a");
    expect(next).not.toBeNull();
    expect(collectLeaves(next)).toEqual(["b", "c"]);
    // The parent split must disappear, not linger with one child.
    expect(next?.type).toBe("split");
    expect((next as Extract<LayoutNode, { type: "split" }>).dir).toBe("v");
  });

  it("returns null once the last pane is removed", () => {
    expect(removeLeaf(leaf("a"), "a")).toBeNull();
  });

  it("is a no-op for an unknown pane", () => {
    const before = tree();
    expect(removeLeaf(before, "zzz")).toEqual(before);
  });

  it("removing every leaf one by one ends at null", () => {
    let node: LayoutNode | null = tree();
    for (const id of ["b", "a", "c"]) {
      node = node ? removeLeaf(node, id) : null;
    }
    expect(node).toBeNull();
  });
});

describe("filterLayout", () => {
  it("keeps only the requested panes and rebalances", () => {
    const next = filterLayout(tree(), new Set(["a", "c"]));
    expect(collectLeaves(next)).toEqual(["a", "c"]);
  });

  it("returns null when nothing survives", () => {
    expect(filterLayout(tree(), new Set())).toBeNull();
  });

  it("returns a bare leaf when only one survives", () => {
    expect(filterLayout(tree(), new Set(["b"]))).toEqual(leaf("b"));
  });
});

describe("setRatioAt", () => {
  it("sets the ratio at the root", () => {
    const next = setRatioAt(tree(), [0], 0.7);
    expect((next as Extract<LayoutNode, { type: "split" }>).ratio).toBeCloseTo(0.7);
  });

  it("clamps to the 0.15-0.85 band so a pane can never collapse", () => {
    const low = setRatioAt(tree(), [0], -5);
    const high = setRatioAt(tree(), [0], 99);
    expect((low as Extract<LayoutNode, { type: "split" }>).ratio).toBeCloseTo(0.15);
    expect((high as Extract<LayoutNode, { type: "split" }>).ratio).toBeCloseTo(0.85);
  });

  it("walks into a nested split", () => {
    const next = setRatioAt(tree(), [1, 0], 0.25) as Extract<
      LayoutNode,
      { type: "split" }
    >;
    const nested = next.children[1] as Extract<LayoutNode, { type: "split" }>;
    expect(nested.ratio).toBeCloseTo(0.25);
    expect(next.ratio).toBeCloseTo(0.5);
  });

  it("leaves a leaf alone", () => {
    expect(setRatioAt(leaf("a"), [0], 0.3)).toEqual(leaf("a"));
  });
});
