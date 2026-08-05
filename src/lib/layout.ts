export type LayoutNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      dir: "h" | "v";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };

export function firstLeaf(node: LayoutNode | null): string | null {
  if (!node) return null;
  if (node.type === "leaf") return node.paneId;
  return firstLeaf(node.children[0]) ?? firstLeaf(node.children[1]);
}

export function collectLeaves(node: LayoutNode | null): string[] {
  if (!node) return [];
  if (node.type === "leaf") return [node.paneId];
  return [...collectLeaves(node.children[0]), ...collectLeaves(node.children[1])];
}

export function filterLayout(
  node: LayoutNode | null,
  paneIds: Set<string>,
): LayoutNode | null {
  if (!node) return null;
  if (node.type === "leaf") return paneIds.has(node.paneId) ? node : null;

  const left = filterLayout(node.children[0], paneIds);
  const right = filterLayout(node.children[1], paneIds);
  if (!left) return right;
  if (!right) return left;
  return { ...node, children: [left, right] };
}

export function insertSplit(
  node: LayoutNode,
  paneId: string,
  dir: "h" | "v",
  newPaneId: string,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.paneId === paneId) {
      return {
        type: "split",
        dir,
        ratio: 0.5,
        children: [
          { type: "leaf", paneId },
          { type: "leaf", paneId: newPaneId },
        ],
      };
    }
    return node;
  }
  return {
    ...node,
    children: [
      insertSplit(node.children[0], paneId, dir, newPaneId),
      insertSplit(node.children[1], paneId, dir, newPaneId),
    ],
  };
}

export function removeLeaf(
  node: LayoutNode,
  paneId: string,
): LayoutNode | null {
  if (node.type === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  const [a, b] = [
    removeLeaf(node.children[0], paneId),
    removeLeaf(node.children[1], paneId),
  ];
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, children: [a, b] };
}

export function setRatioAt(
  node: LayoutNode,
  path: number[],
  ratio: number,
): LayoutNode {
  if (node.type !== "split" || path.length === 0) return node;
  const clamped = Math.min(0.85, Math.max(0.15, ratio));
  if (path.length === 1) {
    return { ...node, ratio: clamped };
  }
  const idx = path[0];
  const children: [LayoutNode, LayoutNode] = [...node.children];
  children[idx] = setRatioAt(children[idx], path.slice(1), ratio);
  return { ...node, children };
}
