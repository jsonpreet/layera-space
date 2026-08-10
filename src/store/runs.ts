import {
  cancelRun,
  listRuns,
  startRun,
  type RunEvent,
  type RunRecord,
  type RunSpec,
} from "../lib/run";
import {
  initRunBus,
  onAnyRunExit,
  onRunEvents,
  onRunExit,
  onRunSpawn,
} from "../lib/runbus";
import type { GetState, SetState, Slice } from "./types";

/**
 * Events kept in memory per run. The full stream is always on disk in the
 * transcript; this only bounds what the UI holds.
 */
const MAX_EVENTS = 2000;

export type LiveRun = {
  record: RunRecord;
  events: RunEvent[];
  /** True once the batched stream has been trimmed, so the UI can say so. */
  trimmed: boolean;
  fellBack: boolean;
  command?: string;
};

export type RunSlice = {
  runs: Record<string, LiveRun>;
  runHistory: Record<string, RunRecord[]>;

  initRuns: () => Promise<void>;
  launchRun: (spec: RunSpec) => Promise<RunRecord>;
  stopRun: (runId: string) => Promise<void>;
  refreshRunHistory: (workspaceId: string) => Promise<void>;
  clearRun: (runId: string) => void;
};

let doneHandler: ((record: RunRecord) => void) | null = null;

/** Same reason as the workspace slice: StrictMode calls effects twice. */
let runsStarted = false;

/** Set by the alerts layer so finished headless runs can chime like panes do. */
export function setRunDoneHandler(fn: ((record: RunRecord) => void) | null) {
  doneHandler = fn;
}

function subscribe(set: SetState, get: GetState, runId: string) {
  const offEvents = onRunEvents(runId, (incoming) => {
    set((s) => {
      const live = s.runs[runId];
      if (!live) return {};
      const merged = [...live.events, ...incoming];
      const trimmed = merged.length > MAX_EVENTS;
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...live,
            events: trimmed ? merged.slice(-MAX_EVENTS) : merged,
            trimmed: live.trimmed || trimmed,
          },
        },
      };
    });
  });

  const offSpawn = onRunSpawn(runId, (payload) => {
    set((s) => {
      const live = s.runs[runId];
      if (!live) return {};
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...live,
            fellBack: payload.fellBack,
            command: [payload.program, ...payload.args].join(" "),
            record: { ...live.record, runner: payload.runner },
          },
        },
      };
    });
  });

  const offExit = onRunExit(runId, ({ record }) => {
    offEvents();
    offSpawn();
    offExit();
    set((s) => {
      const live = s.runs[runId];
      if (!live) return {};
      return { runs: { ...s.runs, [runId]: { ...live, record } } };
    });
    void get().refreshRunHistory(record.workspaceId);
  });
}

export const createRunSlice: Slice<RunSlice> = (set, get) => ({
  runs: {},
  runHistory: {},

  initRuns: async () => {
    if (runsStarted) return;
    runsStarted = true;
    await initRunBus();
    onAnyRunExit(({ record }) => {
      doneHandler?.(record);
      // A graph node that changed files leaves a note behind, so the next
      // agent in the graph inherits what happened rather than rediscovering it.
      if (record.graphRunId && record.filesChanged.length > 0) {
        void get().writeHandoff(record);
      }
    });
  },

  launchRun: async (spec) => {
    const record = await startRun(spec);
    set((s) => ({
      runs: {
        ...s.runs,
        [record.runId]: {
          record,
          events: [],
          trimmed: false,
          fellBack: record.runner !== record.requestedRunner,
        },
      },
    }));
    subscribe(set, get, record.runId);
    return record;
  },

  stopRun: async (runId) => {
    await cancelRun(runId).catch(() => false);
  },

  refreshRunHistory: async (workspaceId) => {
    const records = await listRuns(workspaceId).catch(() => []);
    set((s) => ({ runHistory: { ...s.runHistory, [workspaceId]: records } }));
  },

  clearRun: (runId) => {
    set((s) => {
      const runs = { ...s.runs };
      delete runs[runId];
      return { runs };
    });
  },
});
