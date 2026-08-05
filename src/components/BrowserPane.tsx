import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Pane } from "../store/app";
import { useApp } from "../store/app";
import { IconRefreshCw, IconExternalLink } from "./icons";

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "about:blank";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^(localhost|127\.|192\.168\.|10\.|0\.0\.0\.0)/i.test(s)) return "http://" + s;
  return "https://" + s;
}

export function BrowserPane({ pane }: { pane: Pane }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const creatingRef = useRef(false);
  const mountedRef = useRef(false);
  const targetUrlRef = useRef(pane.url ?? "");
  const updatePane = useApp((s) => s.updatePane);
  const [input, setInput] = useState(pane.url ?? "");
  const [hint, setHint] = useState(!pane.url);

  const label = `browser-${pane.id}`;

  const syncRect = () => {
    const el = containerRef.current;
    const wv = webviewRef.current;
    if (!el || !wv) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    void wv.setPosition(new LogicalPosition(r.left, r.top));
    void wv.setSize(new LogicalSize(r.width, r.height));
  };

  const ensure = () => {
    const el = containerRef.current;
    if (
      !mountedRef.current ||
      !targetUrlRef.current ||
      !el ||
      webviewRef.current ||
      creatingRef.current
    )
      return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    creatingRef.current = true;
    void Webview.getByLabel(label).then((existing) => {
      if (!mountedRef.current) {
        if (existing) void existing.hide();
        return;
      }
      if (existing) {
        webviewRef.current = existing;
        syncRect();
        void existing.show();
        setHint(false);
        return;
      }
      const wv = new Webview(getCurrentWindow(), label, {
        url: targetUrlRef.current || "about:blank",
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        focus: false,
        acceptFirstMouse: true,
      });
      wv.once("tauri://error", (e) => console.error("webview error", e));
      wv.once("tauri://created", () => {
        if (mountedRef.current) syncRect();
        else void wv.close();
      });
      webviewRef.current = wv;
      setHint(false);
    }).catch((error) => {
      console.error("browser webview lookup failed", error);
    }).finally(() => {
      creatingRef.current = false;
    });
  };

  const navigate = (url: string) => {
    const target = normalizeUrl(url);
    targetUrlRef.current = target;
    setInput(target);
    updatePane(pane.id, { url: target });
    if (webviewRef.current) {
      void invoke("browser_navigate", { label, url: target });
    } else {
      ensure();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(input);
  };

  const canAct = !!targetUrlRef.current && targetUrlRef.current !== "about:blank";

  useEffect(() => {
    mountedRef.current = true;
    ensure();
    const ro = new ResizeObserver(() => {
      syncRect();
      ensure();
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      mountedRef.current = false;
      ro.disconnect();
      const webview = webviewRef.current;
      webviewRef.current = null;
      if (webview) void webview.hide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://… or localhost:5173"
            className="h-6 w-full flex-1 rounded border border-line bg-base px-2 text-xs text-ink outline-none placeholder:text-faint focus:border-accent/50"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="submit"
            className="rounded px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            Go
          </button>
        </form>
        <button
          onClick={() => canAct && navigate(targetUrlRef.current)}
          disabled={!canAct}
          className="rounded p-1 text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          title="Reload"
        >
          <IconRefreshCw />
        </button>
        <button
          onClick={() => {
            if (canAct) void openUrl(targetUrlRef.current);
          }}
          disabled={!canAct}
          className="rounded p-1 text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          title="Open in default browser"
        >
          <IconExternalLink />
        </button>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-base">
        {hint && (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            Enter a URL to preview
          </div>
        )}
      </div>
    </div>
  );
}
