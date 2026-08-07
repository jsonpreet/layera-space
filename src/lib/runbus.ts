import { listen } from "@tauri-apps/api/event";
import type { EventsPayload, ExitPayload, SpawnPayload } from "./run";

/**
 * Fan-out for run events, mirroring `bus.ts` for pty output: one global
 * listener per event name, dispatched to per-run subscribers.
 *
 * Registering a Tauri listener per run would mean one IPC subscription per
 * concurrent builder, and would race with runs that start before the UI mounts.
 */

type EventsHandler = (events: EventsPayload["events"]) => void;
type ExitHandler = (payload: ExitPayload) => void;
type SpawnHandler = (payload: SpawnPayload) => void;

const eventSubs = new Map<string, Set<EventsHandler>>();
const exitSubs = new Map<string, Set<ExitHandler>>();
const spawnSubs = new Map<string, Set<SpawnHandler>>();
const anyExit = new Set<ExitHandler>();

let started = false;

export async function initRunBus() {
  if (started) return;
  started = true;

  await listen<EventsPayload>("run://events", (e) => {
    const subs = eventSubs.get(e.payload.runId);
    if (subs) for (const fn of subs) fn(e.payload.events);
  });

  await listen<SpawnPayload>("run://spawn", (e) => {
    const subs = spawnSubs.get(e.payload.runId);
    if (subs) for (const fn of subs) fn(e.payload);
  });

  await listen<ExitPayload>("run://exit", (e) => {
    const subs = exitSubs.get(e.payload.runId);
    if (subs) for (const fn of subs) fn(e.payload);
    for (const fn of anyExit) fn(e.payload);
  });
}

function add<T>(map: Map<string, Set<T>>, key: string, fn: T): () => void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) map.delete(key);
  };
}

export function onRunEvents(runId: string, fn: EventsHandler) {
  return add(eventSubs, runId, fn);
}

export function onRunSpawn(runId: string, fn: SpawnHandler) {
  return add(spawnSubs, runId, fn);
}

export function onRunExit(runId: string, fn: ExitHandler) {
  return add(exitSubs, runId, fn);
}

/** Every completed run, regardless of id — used for alerts and the graph. */
export function onAnyRunExit(fn: ExitHandler) {
  anyExit.add(fn);
  return () => anyExit.delete(fn);
}

/** Resolves when a specific run finishes. The scheduler awaits this. */
export function waitForRun(runId: string): Promise<ExitPayload> {
  return new Promise((resolve) => {
    const off = onRunExit(runId, (payload) => {
      off();
      resolve(payload);
    });
  });
}
