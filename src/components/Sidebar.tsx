import { useApp } from "../store/app";
import { LayersMark } from "./LayersMark";
import { SettingsPopover } from "./SettingsPopover";
import { SkillsPanel } from "./skills/SkillsPanel";
import { WorkspaceItem } from "./WorkspaceItem";

export function Sidebar() {
  const { workspaces, activeWorkspaceId, createWorkspace } = useApp();
  const pinned = workspaces.filter((w) => w.pinned);
  const others = workspaces.filter((w) => !w.pinned);

  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
        <LayersMark className="h-[18px] w-[18px]" />
        <span className="text-[13px] font-semibold">Layera Space</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {pinned.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-faint">
              Pinned
            </div>
            {pinned.map((ws) => (
              <WorkspaceItem
                key={ws.id}
                ws={ws}
                active={ws.id === activeWorkspaceId}
              />
            ))}
          </>
        )}

        {others.length > 0 && (
          <>
            {pinned.length > 0 && (
              <div className="px-2 pb-1 pt-3 text-[11px] font-medium text-faint">
                Workspaces
              </div>
            )}
            {others.map((ws) => (
              <WorkspaceItem
                key={ws.id}
                ws={ws}
                active={ws.id === activeWorkspaceId}
              />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-line p-2">
        <button
          onClick={() => void createWorkspace()}
          className="mb-1.5 w-full rounded-md border border-line bg-base px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          + New workspace
        </button>
        <SkillsPanel />
        <SettingsPopover />
      </div>
    </aside>
  );
}
