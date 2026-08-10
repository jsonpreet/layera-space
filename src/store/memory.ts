import {
  handoffNote,
  memoryDelete,
  memoryIndex,
  memoryInit,
  memoryWrite,
  selectContext,
  toContextBlocks,
  type Note,
  type Selection,
} from "../lib/memory";
import type { ContextBlock, RunRecord } from "../lib/run";
import { RUNNER_LABEL } from "../lib/run";
import type { Slice } from "./types";

export type MemorySlice = {
  notes: Record<string, Note[]>;
  /** Which vault folders feed the recency pass, per workspace. */
  memoryDirs: string[];
  memoryEnabled: boolean;

  refreshNotes: (workspaceId: string) => Promise<Note[]>;
  initMemory: (workspaceId: string) => Promise<void>;
  saveNote: (workspaceId: string, rel: string, content: string) => Promise<void>;
  deleteNote: (workspaceId: string, rel: string) => Promise<void>;
  setMemoryDirs: (dirs: string[]) => void;
  setMemoryEnabled: (enabled: boolean) => void;
  /** What would be injected for this prompt, without sending anything. */
  previewContext: (workspaceId: string, prompt: string) => Selection;
  contextFor: (workspaceId: string, prompt: string) => Promise<ContextBlock[]>;
  writeHandoff: (record: RunRecord) => Promise<void>;
};

export const createMemorySlice: Slice<MemorySlice> = (set, get) => ({
  notes: {},
  memoryDirs: ["context", "decisions"],
  memoryEnabled: true,

  refreshNotes: async (workspaceId) => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws?.folder) return [];
    const notes = await memoryIndex(ws.folder).catch(() => []);
    set((s) => ({ notes: { ...s.notes, [workspaceId]: notes } }));
    return notes;
  },

  initMemory: async (workspaceId) => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws?.folder) return;
    await memoryInit(ws.folder).catch(() => "");
    await get().refreshNotes(workspaceId);
  },

  saveNote: async (workspaceId, rel, content) => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws?.folder) return;
    await memoryWrite(ws.folder, rel, content);
    await get().refreshNotes(workspaceId);
  },

  deleteNote: async (workspaceId, rel) => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws?.folder) return;
    await memoryDelete(ws.folder, rel);
    await get().refreshNotes(workspaceId);
  },

  setMemoryDirs: (dirs) => set({ memoryDirs: dirs }),
  setMemoryEnabled: (memoryEnabled) => set({ memoryEnabled }),

  previewContext: (workspaceId, prompt) => {
    const state = get();
    if (!state.memoryEnabled) {
      return { notes: [], reasons: new Map(), totalChars: 0, truncated: false };
    }
    return selectContext(prompt, state.notes[workspaceId] ?? [], {
      dirs: state.memoryDirs,
    });
  },

  contextFor: async (workspaceId, prompt) => {
    const selection = get().previewContext(workspaceId, prompt);
    if (selection.notes.length === 0) return [];
    return toContextBlocks(selection.notes);
  },

  /**
   * Generated mechanically from the run record rather than by asking a model:
   * free, deterministic, and it cannot hallucinate what changed.
   */
  writeHandoff: async (record) => {
    const ws = get().workspaces.find((w) => w.id === record.workspaceId);
    if (!ws?.folder) return;
    const { rel, content } = handoffNote({
      label: record.label || record.promptPreview || "Run",
      runner: RUNNER_LABEL[record.runner],
      summary: record.summary,
      files: record.filesChanged.map((f) => ({ path: f.path, status: f.status })),
      when: record.startedAt,
    });
    await memoryWrite(ws.folder, rel, content).catch(() => "");
    await get().refreshNotes(record.workspaceId);
  },
});
