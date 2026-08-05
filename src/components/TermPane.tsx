import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { decodeB64, resizePty, writePty } from "../lib/pty";
import { subscribePtyOutput } from "../lib/bus";
import { TERM_OPTIONS, TERM_THEME } from "../lib/theme";

const enc = new TextEncoder();

export function TermPane({
  ptyId,
  onBell,
  onFitted,
}: {
  ptyId: string;
  onBell?: () => void;
  /** Fires once, with the real geometry, after the first successful fit. */
  onFitted?: (cols: number, rows: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const bellRef = useRef(onBell);
  bellRef.current = onBell;
  const fittedRef = useRef(onFitted);
  fittedRef.current = onFitted;

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    const term = new Terminal({
      ...TERM_OPTIONS,
      cursorBlink: true,
      scrollback: 5000,
      theme: { ...TERM_THEME },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // webgl unavailable; canvas fallback is fine
    }

    let announced = false;
    const doFit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
        void resizePty(ptyId, term.cols, term.rows);
        // Recording starts only once the pane has real dimensions. Starting it
        // at spawn time stamped every cast header with a placeholder 80x24, so
        // every replay rendered at the wrong size.
        if (!announced) {
          announced = true;
          fittedRef.current?.(term.cols, term.rows);
        }
      } catch {
        // container may be hidden during layout changes
      }
    };
    doFit();

    const unsubscribe = subscribePtyOutput(ptyId, (b64) => {
      term.write(decodeB64(b64));
    });

    const dataSub = term.onData((d) => {
      void writePty(ptyId, Array.from(enc.encode(d)));
    });

    const bellSub = term.onBell(() => {
      bellRef.current?.();
    });

    const ro = new ResizeObserver(doFit);
    ro.observe(el);

    return () => {
      ro.disconnect();
      unsubscribe();
      dataSub.dispose();
      bellSub.dispose();
      term.dispose();
    };
  }, [ptyId]);

  return <div ref={holder} className="h-full w-full p-2" />;
}
