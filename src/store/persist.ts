import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_SETTINGS,
  type AppState,
  type GetState,
  type SavedPane,
  type Settings,
  type Workspace,
} from "./types";

export const STORE_VERSION = 2;

type Saved = {
  version?: number;
  workspaces?: Workspace[];
  settings?: Partial<Settings>;
  panes?: SavedPane[];
};

export type Hydrated = {
  workspaces: Workspace[];
  settings: Settings;
  panes: SavedPane[];
};

/**
 * Bring an older on-disk shape up to the current one. v1 predates the
 * configurable idle threshold, so its settings simply inherit the defaults.
 */
export function migrate(parsed: Saved): Hydrated {
  const workspaces = parsed.workspaces ?? [];
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
  const panes = parsed.panes ?? [];

  // Guard against a hand-edited or corrupted threshold locking alerts off.
  if (!Number.isFinite(settings.idleMs) || settings.idleMs < 1000) {
    settings.idleMs = DEFAULT_SETTINGS.idleMs;
  }

  const ids = new Set(workspaces.map((w) => w.id));
  return {
    workspaces,
    settings,
    panes: panes.filter((p) => ids.has(p.workspaceId)),
  };
}

export async function loadStore(): Promise<Hydrated> {
  try {
    const raw = await invoke<string>("store_load");
    return migrate(JSON.parse(raw) as Saved);
  } catch {
    return { workspaces: [], settings: { ...DEFAULT_SETTINGS }, panes: [] };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Debounced whole-blob save. Deliberately hand-rolled rather than zustand's
 * persist middleware: it strips the runtime-only pane fields and routes through
 * the Rust side's atomic tmp+rename write.
 *
 * Rail threads and live run events are intentionally NOT persisted here — this
 * rewrites the entire file on every call, and streaming into it would mean
 * continuously rewriting a growing JSON blob for the length of every run.
 */
export function schedulePersist(get: GetState) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { workspaces, settings } = get();
    const panes = get().panes.map(
      ({ ptyId, status, activity, doneSource, ...rest }) => rest,
    );
    void invoke("store_save", {
      json: JSON.stringify({
        version: STORE_VERSION,
        workspaces,
        settings,
        panes,
      }),
    });
  }, 400);
}

export function patchWorkspace(
  s: AppState,
  id: string,
  patch: Partial<Workspace>,
): Partial<AppState> {
  return {
    workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  };
}
