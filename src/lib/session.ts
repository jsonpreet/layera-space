import { invoke } from "@tauri-apps/api/core";

export type SessionMeta = {
  path: string;
  title: string;
  started_at: number;
  size: number;
};

export function sessionBegin(
  ptyId: string,
  workspaceId: string,
  title: string,
  rows = 24,
  cols = 80,
) {
  return invoke<string>("session_begin", {
    id: ptyId,
    workspaceId,
    title,
    rows,
    cols,
  });
}

export function listSessions(workspaceId: string) {
  return invoke<SessionMeta[]>("list_sessions", { workspaceId });
}

export function readSession(path: string) {
  return invoke<string>("read_session", { path });
}
