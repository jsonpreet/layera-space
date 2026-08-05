import { useRef, useState } from "react";
import type { Workspace } from "../store/app";
import { useApp } from "../store/app";
import { listSessions, type SessionMeta } from "../lib/session";
import { OverlayMark } from "../lib/useOverlay";

function relTime(epochSec: number): string {
  const diff = Math.max(0, Date.now() / 1000 - epochSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function HistoryMenu({ ws }: { ws: Workspace }) {
  const { openReplay } = useApp();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);

  const toggle = async () => {
    if (openAt) {
      setOpenAt(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setOpenAt({ x: Math.max(8, r.right - 300), y: r.bottom + 6 });
    try {
      setSessions(await listSessions(ws.id));
    } catch {
      setSessions([]);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => void toggle()}
        className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        History
      </button>

      {openAt && <OverlayMark />}
      {openAt && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpenAt(null)} />
          <div
            className="fixed z-50 max-h-[340px] w-[300px] overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            style={{ left: openAt.x, top: openAt.y }}
          >
            {sessions === null ? (
              <div className="px-3 py-2 text-xs text-faint">Loading…</div>
            ) : sessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-faint">
                No recorded sessions yet
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.path}
                  onClick={() => {
                    setOpenAt(null);
                    openReplay(ws.id, s.path, s.title);
                  }}
                  className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[13px] text-ink">
                      {s.title}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-faint">
                      {relTime(s.started_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10px] text-faint">
                    {sizeLabel(s.size)} · replay
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}
