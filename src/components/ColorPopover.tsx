import { useEffect, useRef, useState } from "react";
import { useOverlay } from "../lib/useOverlay";

export const WORKSPACE_COLORS = [
  "#c98f52",
  "#d47a5c",
  "#d3a24b",
  "#8fa65b",
  "#7fae72",
  "#5f8f7a",
  "#6fb0a8",
  "#6f9bb5",
  "#8d93c4",
  "#b58bb0",
  "#c2787a",
  "#b8b0a2",
];

export function ColorPopover({
  x,
  y,
  value,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  value: string;
  onPick: (color: string) => void;
  onClose: () => void;
}) {
  useOverlay();
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pos = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 160),
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        ref={ref}
        className="fixed z-50 w-[204px] rounded-lg border border-line bg-raised p-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        style={pos}
      >
        <div className="grid grid-cols-6 gap-2">
          {WORKSPACE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                onPick(c);
                onClose();
              }}
              className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                value === c ? "ring-2 ring-ink/70 ring-offset-2 ring-offset-raised" : ""
              }`}
              style={{ background: c }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(custom) ? custom : "#c98f52"}
            onChange={(e) => setCustom(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent"
          />
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => {
              if (/^#[0-9a-fA-F]{6}$/.test(custom)) {
                onPick(custom.toLowerCase());
                onClose();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full rounded border border-line bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
            placeholder="#c98f52"
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}
