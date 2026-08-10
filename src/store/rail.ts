import { buildPrompt, parsePlan, titleFrom, type PlanStep } from "../lib/prompts";
import type { RunMode, Runner } from "../lib/run";
import type { Slice } from "./types";

export type RailMode = "chat" | "plan" | "build";

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  mode: RailMode;
  text: string;
  at: number;
  runId?: string;
  /** Plan mode only: steps parsed out of the response. */
  steps?: PlanStep[];
};

export type RailThread = {
  messages: Message[];
  draft: string;
  activeRunId: string | null;
};

export type RailSlice = {
  /**
   * Threads live in memory only. `schedulePersist` rewrites the whole store
   * blob, so streaming a conversation into it would mean continuously
   * rewriting a growing JSON file for the length of every run. Past runs are
   * recoverable from the transcripts on disk.
   */
  rail: Record<string, RailThread>;

  setRailOpen: (open: boolean) => void;
  setRailWidth: (width: number) => void;
  setRailMode: (mode: RailMode) => void;
  setRailRunner: (runner: Runner) => void;
  setRailWrite: (write: boolean) => void;
  setDraft: (workspaceId: string, draft: string) => void;
  clearThread: (workspaceId: string) => void;
  submitComposer: (workspaceId: string) => Promise<void>;
  cancelComposer: (workspaceId: string) => Promise<void>;
  pushPlanToBoard: (workspaceId: string, steps: PlanStep[]) => Promise<void>;
};

const EMPTY: RailThread = { messages: [], draft: "", activeRunId: null };

export function threadFor(
  rail: Record<string, RailThread>,
  workspaceId: string,
): RailThread {
  return rail[workspaceId] ?? EMPTY;
}

export const createRailSlice: Slice<RailSlice> = (set, get) => {
  const patchThread = (workspaceId: string, patch: Partial<RailThread>) =>
    set((s) => ({
      rail: {
        ...s.rail,
        [workspaceId]: { ...threadFor(s.rail, workspaceId), ...patch },
      },
    }));

  const addMessage = (workspaceId: string, message: Message) =>
    set((s) => {
      const thread = threadFor(s.rail, workspaceId);
      return {
        rail: {
          ...s.rail,
          [workspaceId]: {
            ...thread,
            messages: [...thread.messages, message],
          },
        },
      };
    });

  const updateMessage = (
    workspaceId: string,
    id: string,
    patch: Partial<Message>,
  ) =>
    set((s) => {
      const thread = threadFor(s.rail, workspaceId);
      return {
        rail: {
          ...s.rail,
          [workspaceId]: {
            ...thread,
            messages: thread.messages.map((m) =>
              m.id === id ? { ...m, ...patch } : m,
            ),
          },
        },
      };
    });

  return {
    rail: {},

    setRailOpen: (open) => get().updateSettings({ railOpen: open }),
    setRailWidth: (width) =>
      get().updateSettings({ railWidth: Math.min(720, Math.max(320, width)) }),
    setRailMode: (mode) => get().updateSettings({ railMode: mode }),
    setRailRunner: (runner) => get().updateSettings({ railRunner: runner }),
    setRailWrite: (write) => get().updateSettings({ railWrite: write }),

    setDraft: (workspaceId, draft) => patchThread(workspaceId, { draft }),

    clearThread: (workspaceId) =>
      patchThread(workspaceId, { messages: [], activeRunId: null }),

    submitComposer: async (workspaceId) => {
      const state = get();
      const thread = threadFor(state.rail, workspaceId);
      const input = thread.draft.trim();
      if (!input || thread.activeRunId) return;

      const ws = state.workspaces.find((w) => w.id === workspaceId);
      const mode = state.settings.railMode;
      const runner = state.settings.railRunner;
      const cwd = ws?.folder;

      if (!cwd) {
        addMessage(workspaceId, {
          id: crypto.randomUUID(),
          role: "system",
          mode,
          at: Date.now(),
          text: "This workspace has no project folder yet. Pick one in the workspace header first — runs need a working directory.",
        });
        return;
      }

      addMessage(workspaceId, {
        id: crypto.randomUUID(),
        role: "user",
        mode,
        text: input,
        at: Date.now(),
      });
      patchThread(workspaceId, { draft: "" });

      const runId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      addMessage(workspaceId, {
        id: assistantId,
        role: "assistant",
        mode,
        text: "",
        at: Date.now(),
        runId,
      });
      patchThread(workspaceId, { activeRunId: runId });

      const runMode: RunMode = mode;
      // Build writes; chat and plan are questions and stay read-only.
      const write = mode === "build" ? state.settings.railWrite : false;

      // Enabled skills first, then project memory: instructions before facts.
      const context = [
        ...state.skillBlocks(),
        ...(await state.contextFor(workspaceId, input).catch(() => [])),
      ];

      try {
        await state.launchRun({
          runId,
          workspaceId,
          runner,
          prompt: buildPrompt(runMode, input),
          cwd,
          mode: runMode,
          write,
          context,
          label: titleFrom(input),
          captureDiff: mode === "build",
          runnerPaths: state.settings.runnerPaths,
        });
      } catch (error) {
        updateMessage(workspaceId, assistantId, {
          text: String(error),
        });
        patchThread(workspaceId, { activeRunId: null });
        return;
      }

      // Mirror the streamed answer into the thread, then settle on exit.
      const { onRunEvents, onRunExit } = await import("../lib/runbus");
      let buffer = "";
      const offEvents = onRunEvents(runId, (events) => {
        let changed = false;
        for (const ev of events) {
          if (ev.kind === "assistant" && ev.text) {
            buffer = buffer ? `${buffer}\n${ev.text}` : ev.text;
            changed = true;
          }
        }
        if (changed) updateMessage(workspaceId, assistantId, { text: buffer });
      });

      const offExit = onRunExit(runId, ({ record }) => {
        offEvents();
        offExit();
        const finalText = record.summary?.trim() || buffer;
        const failed = record.status !== "ok";
        const text =
          finalText ||
          (failed
            ? `${record.runner} ${record.status}${
                record.exitCode != null ? ` (exit ${record.exitCode})` : ""
              } — see the log below.`
            : "(no output)");
        updateMessage(workspaceId, assistantId, {
          text,
          steps: mode === "plan" ? parsePlan(finalText) : undefined,
        });
        patchThread(workspaceId, { activeRunId: null });
      });
    },

    cancelComposer: async (workspaceId) => {
      const thread = threadFor(get().rail, workspaceId);
      if (!thread.activeRunId) return;
      await get().stopRun(thread.activeRunId);
    },

    pushPlanToBoard: async (workspaceId, steps) => {
      if (steps.length === 0) return;
      const { addCardsToBoard } = await import("../lib/board");
      const path = await get().boardPathFor(workspaceId);
      if (!path) return;
      try {
        await addCardsToBoard(
          path,
          steps.map((s) => s.text),
        );
      } catch (error) {
        addMessage(workspaceId, {
          id: crypto.randomUUID(),
          role: "system",
          mode: "plan",
          at: Date.now(),
          text: `Could not write to the board: ${String(error)}`,
        });
        return;
      }
      await get().openKanban(workspaceId);
      addMessage(workspaceId, {
        id: crypto.randomUUID(),
        role: "system",
        mode: "plan",
        at: Date.now(),
        text: `Added ${steps.length} card${steps.length === 1 ? "" : "s"} to the board.`,
      });
    },
  };
};
