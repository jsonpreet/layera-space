import { create } from "zustand";
import { createPaneSlice } from "./panes";
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
}));

export { setDoneHandler } from "./panes";
export * from "./types";
