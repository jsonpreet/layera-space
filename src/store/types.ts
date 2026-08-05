import type { AgentKind } from "../lib/agents";
import type { LayoutNode } from "../lib/layout";
import type { SoundKind } from "../lib/sound";

export type PaneKind =
  | "shell"
  | "agent"
  | "replay"
  | "kanban"
  | "browser"
  | "editor"
  | "diff"
  | "graph"
  | "memory";

export type PaneStatus = "running" | "exited";
export type PaneActivity = "idle" | "working" | "done";
export type DoneSource = "hook" | "bell" | "idle";

export type Pane = {
  id: string;
  ptyId: string;
  workspaceId: string;
  kind: PaneKind;
  agent?: AgentKind;
  title: string;
  status: PaneStatus;
  activity: PaneActivity;
  doneSource: DoneSource | null;
  sessionPath?: string;
  boardPath?: string;
  url?: string;
  filePath?: string;
  /** diff panes: the run whose changes are under review */
  runId?: string;
  /** graph panes: which graph is open */
  graphId?: string;
  /** memory panes: the note being edited */
  notePath?: string;
};

/** Runtime-only fields never reach disk. */
export type SavedPane = Omit<
  Pane,
  "ptyId" | "status" | "activity" | "doneSource"
>;

export type Workspace = {
  id: string;
  title: string;
  color: string;
  pinned: boolean;
  folder: string | null;
  createdAt: number;
  layout: LayoutNode | null;
  muted?: boolean;
  folderAsked?: boolean;
  ignoreAsked?: boolean;
  layoutMode?: "grid" | "dock";
  dockRatio?: number;
  graphId?: string;
};

export type Settings = {
  sound: SoundKind | "muted";
  notifyEnabled: boolean;
  /** Silence-after-activity window that marks an interactive agent done. */
  idleMs: number;
};

export const DEFAULT_SETTINGS: Settings = {
  sound: "chime",
  notifyEnabled: true,
  idleMs: 7000,
};

export const DEFAULT_COLOR = "#c98f52";

export type WorkspaceSlice = {
  ready: boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  agents: Record<AgentKind, string | null>;
  hookUrl: string;
  settings: Settings;

  init: () => Promise<void>;
  createWorkspace: (title?: string) => Promise<string>;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
};

export type PaneSlice = {
  panes: Pane[];
  focused: Record<string, string>;
  zoomed: Record<string, string | null>;
  /**
   * Open popovers and modals. Native child webviews render above the React
   * tree, so the browser pane hides itself whenever this is non-zero.
   */
  overlayCount: number;

  pushOverlay: () => void;
  popOverlay: () => void;

  spawnShell: (workspaceId: string, dir?: "h" | "v") => Promise<void>;
  spawnAgent: (
    workspaceId: string,
    kind: AgentKind,
    dir?: "h" | "v",
  ) => Promise<void>;
  openReplay: (workspaceId: string, sessionPath: string, title: string) => void;
  openKanban: (workspaceId: string) => Promise<void>;
  openBrowser: (workspaceId: string) => void;
  openEditor: (workspaceId: string) => void;
  openDiff: (workspaceId: string, runId: string, title: string) => void;
  openGraph: (workspaceId: string) => Promise<void>;
  openMemory: (workspaceId: string) => Promise<void>;
  /**
   * Start cast recording for a pane. Called by the terminal once it has fitted,
   * so the cast header carries the real geometry instead of a placeholder.
   */
  beginRecording: (paneId: string, cols: number, rows: number) => void;
  updatePane: (paneId: string, patch: Partial<Pane>) => void;
  closePane: (paneId: string) => void;
  splitPane: (paneId: string, dir: "h" | "v") => Promise<void>;
  setSplitRatio: (workspaceId: string, path: number[], ratio: number) => void;
  toggleZoom: (workspaceId: string, paneId: string) => void;
  setFocused: (workspaceId: string, paneId: string) => void;
  markDone: (paneId: string, source: DoneSource) => void;
  reportBell: (ptyId: string) => void;
};

export type AppState = WorkspaceSlice & PaneSlice;

export type SetState = {
  (partial: Partial<AppState>): void;
  (fn: (s: AppState) => Partial<AppState>): void;
};
export type GetState = () => AppState;
export type Slice<T> = (set: SetState, get: GetState) => T;
