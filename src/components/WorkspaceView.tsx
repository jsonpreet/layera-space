import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp, type Workspace } from "../store/app";
import { HistoryMenu } from "./HistoryMenu";
import { DockLayoutView } from "./DockLayoutView";
import { LayoutView } from "./LayoutView";
import { LaunchMenu } from "./LaunchMenu";
import { PaneFrame } from "./PaneFrame";

let homeCache: string | null = null;
void homeDir().then((h) => {
  homeCache = h;
});

function shortPath(p: string): string {
  if (homeCache && p.startsWith(homeCache)) {
    return "~" + p.slice(homeCache.length - 1);
  }
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 3) return p;
  return "…/" + parts.slice(-2).join("/");
}

export function WorkspaceView({ ws }: { ws: Workspace }) {
  const { panes, zoomed, spawnShell, updateWorkspace } = useApp();
  const wsPanes = panes.filter((p) => p.workspaceId === ws.id);
  const zoomedPaneId = zoomed[ws.id] ?? null;
  const zoomPane = zoomedPaneId
    ? wsPanes.find((p) => p.id === zoomedPaneId)
    : null;
  const [, force] = useState(0);

  useEffect(() => {
    if (homeCache === null) {
      const t = setTimeout(() => force((n) => n + 1), 300);
      return () => clearTimeout(t);
    }
  }, []);

  const pickFolder = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose project folder",
      defaultPath: ws.folder ?? undefined,
    });
    if (typeof folder === "string") updateWorkspace(ws.id, { folder });
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ background: ws.color }}
        />
        <h2 className="truncate text-[13px] font-semibold">{ws.title}</h2>
        <button
          onClick={() => void pickFolder()}
          className="ml-2 min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-[11px] text-faint transition-colors hover:bg-hover hover:text-muted"
          title={ws.folder ?? "Choose project folder"}
        >
          {ws.folder ? shortPath(ws.folder) : "no folder"}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() =>
              updateWorkspace(ws.id, {
                layoutMode: ws.layoutMode === "dock" ? "grid" : "dock",
              })
            }
            title="Toggle pane layout"
            className="rounded px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-hover hover:text-muted"
          >
            {ws.layoutMode === "dock" ? "Dock" : "Grid"}
          </button>
          <HistoryMenu ws={ws} />
          <LaunchMenu ws={ws} />
        </div>
      </header>

      <section className="min-h-0 flex-1">
        {zoomPane ? (
          <PaneFrame pane={zoomPane} />
        ) : ws.layout ? (
          ws.layoutMode === "dock" ? (
            <DockLayoutView
              wsId={ws.id}
              node={ws.layout}
              panes={wsPanes}
              ratio={ws.dockRatio}
              onRatioChange={(dockRatio) =>
                updateWorkspace(ws.id, { dockRatio })
              }
            />
          ) : (
            <LayoutView wsId={ws.id} node={ws.layout} path={[]} />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-sm text-faint">Nothing running here yet</p>
            <button
              onClick={() => void spawnShell(ws.id)}
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              New shell
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
