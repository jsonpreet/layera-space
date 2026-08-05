import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { AGENTS, type AgentKind } from "./agents";

export type SpawnOpts = {
  cwd?: string;
  rows?: number;
  cols?: number;
  env?: Record<string, string>;
  program?: string;
  args?: string[];
};

export type PtyOutput = { id: string; data: string };
export type PtyExit = { id: string };

export async function spawnPty(opts: SpawnOpts = {}): Promise<string> {
  const cwd = opts.cwd ?? (await homeDir());
  return invoke("pty_spawn", {
    cwd,
    rows: opts.rows ?? 24,
    cols: opts.cols ?? 80,
    env: opts.env ?? {},
    program: opts.program ?? null,
    args: opts.args ?? [],
  });
}

export function writePty(id: string, data: number[]) {
  return invoke("pty_write", { id, data });
}

export function resizePty(id: string, cols: number, rows: number) {
  return invoke("pty_resize", { id, cols, rows });
}

export function killPty(id: string) {
  return invoke("pty_kill", { id });
}

export async function detectAgents(): Promise<Record<AgentKind, string | null>> {
  const names = (Object.keys(AGENTS) as AgentKind[]).map((k) => AGENTS[k].cmd);
  const found = await invoke<Record<string, string | null>>("detect_agents", {
    names,
  });
  const out = {} as Record<AgentKind, string | null>;
  for (const k of Object.keys(AGENTS) as AgentKind[]) {
    out[k] = found[AGENTS[k].cmd] ?? null;
  }
  return out;
}

export function decodeB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
