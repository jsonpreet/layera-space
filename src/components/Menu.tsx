import { useEffect, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  danger?: boolean;
  onClick: () => void;
};

export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - r.width - 8);
    const ny = Math.min(y, window.innerHeight - r.height - 8);
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        ref={ref}
        className="fixed z-50 min-w-[168px] rounded-lg border border-line bg-raised py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`block w-full px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
              item.danger ? "text-[#d47a5c]" : "text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
