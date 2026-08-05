import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { decodeB64, resizePty, writePty } from "../lib/pty";
import { subscribePtyOutput } from "../lib/bus";

const enc = new TextEncoder();

export function TermPane({
  ptyId,
  onBell,
}: {
  ptyId: string;
  onBell?: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const bellRef = useRef(onBell);
  bellRef.current = onBell;

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#16130f",
        foreground: "#ece5da",
        cursor: "#c98f52",
        cursorAccent: "#16130f",
        selectionBackground: "#3a3226",
        black: "#1d1915",
        red: "#d47a5c",
        green: "#7fae72",
        yellow: "#d3a24b",
        blue: "#6f9bb5",
        magenta: "#b58bb0",
        cyan: "#6fb0a8",
        white: "#ece5da",
        brightBlack: "#6b6156",
        brightRed: "#e29179",
        brightGreen: "#96c18a",
        brightYellow: "#e0b668",
        brightBlue: "#88b0c7",
        brightMagenta: "#c7a3c2",
        brightCyan: "#87c2ba",
        brightWhite: "#f5efe6",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // webgl unavailable; canvas fallback is fine
    }

    const doFit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
        void resizePty(ptyId, term.cols, term.rows);
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
