import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Workspace } from "../store/app";
import { useApp } from "../store/app";
import { Menu, type MenuItem } from "./Menu";
import { ColorPopover } from "./ColorPopover";

export function WorkspaceItem({
  ws,
  active,
}: {
  ws: Workspace;
  active: boolean;
}) {
  const { setActiveWorkspace, updateWorkspace, deleteWorkspace } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(ws.title);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [colorAt, setColorAt] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(ws.title), [ws.title]);

  const commitRename = () => {
    const t = draft.trim();
    if (t && t !== ws.title) updateWorkspace(ws.id, { title: t });
    setRenaming(false);
  };

  const openMenu = (e: { clientX: number; clientY: number }) => {
    setConfirming(false);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const pickFolder = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose project folder",
      defaultPath: ws.folder ?? undefined,
    });
    if (typeof folder === "string") updateWorkspace(ws.id, { folder });
  };

  const items: MenuItem[] = confirming
    ? [
        {
          label: "Really delete?",
          danger: true,
          onClick: () => deleteWorkspace(ws.id),
        },
        { label: "Cancel", onClick: () => {} },
      ]
    : [
        { label: "Rename", onClick: () => setRenaming(true) },
        {
          label: "Change color",
          onClick: () => {
            const r = rowRef.current?.getBoundingClientRect();
            setColorAt({ x: r ? r.left + 12 : 40, y: r ? r.bottom + 4 : 40 });
          },
        },
        { label: ws.folder ? "Change folder" : "Choose folder", onClick: () => void pickFolder() },
        {
          label: ws.pinned ? "Unpin" : "Pin",
          onClick: () => updateWorkspace(ws.id, { pinned: !ws.pinned }),
        },
        {
          label: ws.muted ? "Unmute alerts" : "Mute alerts",
          onClick: () => updateWorkspace(ws.id, { muted: !ws.muted }),
        },
        { label: "Delete", danger: true, onClick: () => setConfirming(true) },
      ];

  return (
    <>
      <div
        ref={rowRef}
        onClick={() => setActiveWorkspace(ws.id)}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e);
        }}
        className={`group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
          active ? "bg-raised text-ink" : "text-muted hover:bg-hover/60 hover:text-ink"
        }`}
      >
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${ws.muted ? "opacity-40" : ""}`}
          style={{ background: ws.color }}
          title={ws.muted ? "alerts muted" : undefined}
        />
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-accent/60 bg-panel px-1 py-0.5 text-[13px] text-ink outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{ws.title}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e);
          }}
          className="shrink-0 rounded px-1 text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
          aria-label="workspace menu"
        >
          &hellip;
        </button>
      </div>

      {menu && (
        <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
      {colorAt && (
        <ColorPopover
          x={colorAt.x}
          y={colorAt.y}
          value={ws.color}
          onPick={(color) => updateWorkspace(ws.id, { color })}
          onClose={() => setColorAt(null)}
        />
      )}
    </>
  );
}
