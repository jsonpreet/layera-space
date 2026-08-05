import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { decodeB64 } from "../lib/pty";
import { readSession } from "../lib/session";
import type { Pane } from "../store/app";

type Ev = { t: number; b64: string };

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const SPEEDS = [1, 2, 4, 8];

export function ReplayView({ pane }: { pane: Pane }) {
  const holder = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const eventsRef = useRef<Ev[]>([]);
  const idxRef = useRef(0);
  const baseRef = useRef({ wall: 0, offset: 0 });
  const posRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const el = holder.current;
    if (!el || !pane.sessionPath) return;
    const term = new Terminal({
      fontFamily:
        'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      disableStdin: true,
      scrollback: 5000,
      theme: {
        background: "#16130f",
        foreground: "#ece5da",
        cursor: "#c98f52",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        // hidden during layout
      }
    });
    ro.observe(el);

    readSession(pane.sessionPath)
      .then((content) => {
        const lines = content.split("\n").filter(Boolean);
        try {
          const header = JSON.parse(lines[0]) as {
            width?: number;
            height?: number;
          };
          if (header.width && header.height) {
            term.resize(header.width, header.height);
          }
        } catch {
          // keep default size
        }
        const evs: Ev[] = [];
        for (const line of lines.slice(1)) {
          try {
            const arr = JSON.parse(line) as [number, string, string];
            if (Array.isArray(arr) && arr[1] === "o" && typeof arr[2] === "string") {
              evs.push({ t: arr[0], b64: arr[2] });
            }
          } catch {
            // skip malformed line
          }
        }
        eventsRef.current = evs;
        setTotal(evs.length ? evs[evs.length - 1].t : 0);
        setReady(true);
      })
      .catch((e) => setError(String(e)));

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [pane.sessionPath]);

  const writeUpTo = (t: number) => {
    const term = termRef.current;
    if (!term) return;
    const evs = eventsRef.current;
    while (idxRef.current < evs.length && evs[idxRef.current].t <= t) {
      term.write(decodeB64(evs[idxRef.current].b64));
      idxRef.current++;
    }
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const t =
        baseRef.current.offset +
        ((performance.now() - baseRef.current.wall) / 1000) * speed;
      writeUpTo(t);
      posRef.current = t;
      setPos(t);
      if (idxRef.current >= eventsRef.current.length) {
        baseRef.current.offset = t;
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed]);

  const play = () => {
    if (!ready || total === 0) return;
    if (idxRef.current >= eventsRef.current.length) {
      termRef.current?.reset();
      idxRef.current = 0;
      baseRef.current.offset = 0;
      posRef.current = 0;
      setPos(0);
    }
    baseRef.current.wall = performance.now();
    setPlaying(true);
  };

  const pause = () => {
    baseRef.current.offset = posRef.current;
    setPlaying(false);
  };

  const scrub = (t: number) => {
    setPlaying(false);
    baseRef.current.offset = t;
    posRef.current = t;
    const term = termRef.current;
    if (term) {
      term.reset();
      idxRef.current = 0;
      writeUpTo(t);
    }
    setPos(t);
  };

  const changeSpeed = (v: number) => {
    baseRef.current.offset = posRef.current;
    baseRef.current.wall = performance.now();
    setSpeed(v);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={holder} className="min-h-0 flex-1 p-2" />
      {error && (
        <div className="px-3 pb-2 text-xs text-[#d47a5c]">{error}</div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-line bg-panel px-3">
        <button
          onClick={playing ? pause : play}
          disabled={!ready || total === 0}
          className="rounded border border-line bg-base px-2.5 py-0.5 text-xs text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="font-mono text-[11px] text-faint">
          {fmt(pos)} / {fmt(total)}
        </span>
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.05}
          value={Math.min(pos, total)}
          onChange={(e) => scrub(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[#c98f52]"
          disabled={!ready || total === 0}
        />
        <select
          value={speed}
          onChange={(e) => changeSpeed(Number(e.target.value))}
          className="rounded border border-line bg-base px-1.5 py-0.5 text-xs text-muted outline-none"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
