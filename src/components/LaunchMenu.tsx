import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { AGENTS, AGENT_ORDER, AGENT_TINT, type AgentKind } from "../lib/agents";
import type { Workspace } from "../store/app";
import { useApp } from "../store/app";
import { IconPlus } from "./icons";
import { OverlayMark } from "../lib/useOverlay";

export function LaunchMenu({ ws }: { ws: Workspace }) {
  const {
    agents,
    spawnShell,
    spawnAgent,
    openKanban,
    openBrowser,
    openEditor,
    updateWorkspace,
  } = useApp();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<AgentKind | null>(null);
  const [folderAsk, setFolderAsk] = useState<{
    kind: AgentKind;
    x: number;
    y: number;
  } | null>(null);

  const menuPos = () => {
    const r = btnRef.current?.getBoundingClientRect();
    return r
      ? { x: Math.max(8, r.right - 252), y: r.bottom + 6 }
      : { x: 8, y: 8 };
  };

  const toggle = () => {
    if (openAt) {
      setOpenAt(null);
      return;
    }
    setOpenAt(menuPos());
  };

  const launch = async (kind: AgentKind) => {
    setOpenAt(null);
    if (!ws.folder && !ws.folderAsked) {
      setFolderAsk({ kind, ...menuPos() });
      return;
    }
    await spawnAgent(ws.id, kind);
  };

  const askChooseFolder = async (kind: AgentKind) => {
    setFolderAsk(null);
    const picked = await open({
      directory: true,
      title: `Project folder for ${AGENTS[kind].name}`,
    });
    if (typeof picked === "string") {
      updateWorkspace(ws.id, { folder: picked, folderAsked: true });
    } else {
      updateWorkspace(ws.id, { folderAsked: true });
    }
    await spawnAgent(ws.id, kind);
  };

  const askUseHome = async (kind: AgentKind) => {
    setFolderAsk(null);
    const home = await homeDir();
    updateWorkspace(ws.id, { folder: home, folderAsked: true });
    await spawnAgent(ws.id, kind);
  };

  const copyInstall = (kind: AgentKind) => {
    void navigator.clipboard.writeText(AGENTS[kind].install);
    setCopied(kind);
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1600);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <IconPlus />
        New
      </button>

      {openAt && <OverlayMark />}
      {openAt && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpenAt(null)} />
          <div
            className="fixed z-50 w-[252px] rounded-lg border border-line bg-raised py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            style={{ left: openAt.x, top: openAt.y }}
          >
            <button
              onClick={() => {
                setOpenAt(null);
                void spawnShell(ws.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-hover"
            >
              Shell
            </button>
            <button
              onClick={() => {
                setOpenAt(null);
                void openKanban(ws.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-hover"
            >
              Task board
            </button>
            <button
              onClick={() => {
                setOpenAt(null);
                openBrowser(ws.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-hover"
            >
              Browser
            </button>
            <button
              onClick={() => {
                setOpenAt(null);
                openEditor(ws.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-hover"
            >
              Editor
            </button>
            <div className="mx-3 my-1 border-t border-line" />
            {AGENT_ORDER.map((kind) => {
              const installed = agents[kind] !== null;
              return (
                <button
                  key={kind}
                  onClick={() => (installed ? void launch(kind) : copyInstall(kind))}
                  className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: AGENT_TINT[kind] }}
                    />
                    <span
                      className={`text-[13px] ${installed ? "text-ink" : "text-muted"}`}
                    >
                      {AGENTS[kind].name}
                    </span>
                    <span className="ml-auto text-[10px] text-faint">
                      {installed
                        ? "open"
                        : copied === kind
                          ? "install copied"
                          : "not installed"}
                    </span>
                  </span>
                  {!installed && (
                    <span className="mt-0.5 block truncate pl-3.5 font-mono text-[10px] text-faint">
                      {AGENTS[kind].install}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {folderAsk && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setFolderAsk(null)}
          />
          <div
            className="fixed z-50 w-[264px] rounded-lg border border-line bg-raised p-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            style={{
              left: Math.max(8, folderAsk.x - 12),
              top: folderAsk.y,
            }}
          >
            <p className="text-[13px] text-ink">
              Where should {AGENTS[folderAsk.kind].name} work?
            </p>
            <p className="mt-1 text-[11px] text-faint">
              Sets this workspace's project folder. You won't be asked again.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              <button
                onClick={() => void askChooseFolder(folderAsk.kind)}
                className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover"
              >
                Choose project folder…
              </button>
              <button
                onClick={() => void askUseHome(folderAsk.kind)}
                className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                Use home folder
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
