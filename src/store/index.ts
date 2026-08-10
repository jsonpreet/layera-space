import { create } from "zustand";
import { createPaneSlice } from "./panes";
import { createGraphSlice } from "./graph";
import { createMemorySlice } from "./memory";
import { createSkillSlice } from "./skills";
import { createRailSlice } from "./rail";
import { createRunSlice } from "./runs";
import { createWorkspaceSlice } from "./workspaces";
import type { AppState } from "./types";

/**
 * One store, composed from slices. Splitting the file did not split the store:
 * every slice receives the same `set`/`get`, so cross-slice calls
 * (`get().spawnShell(...)` from the workspace slice, say) work unchanged.
 */
export const useApp = create<AppState>((set, get) => ({
  ...createWorkspaceSlice(set, get),
  ...createPaneSlice(set, get),
  ...createRunSlice(set, get),
  ...createRailSlice(set, get),
  ...createGraphSlice(set, get),
  ...createMemorySlice(set, get),
  ...createSkillSlice(set, get),
}));

export { setDoneHandler } from "./panes";
export { setRunDoneHandler } from "./runs";
export { threadFor } from "./rail";
export type { Message, RailMode, RailThread } from "./rail";
export type { LiveRun } from "./runs";
export type { Skill } from "./skills";
export * from "./types";
