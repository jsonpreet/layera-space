import { useEffect, useState } from "react";
import { useApp, type Settings } from "../store/app";
import { playSound, type SoundKind } from "../lib/sound";
import { OverlayMark } from "../lib/useOverlay";
import { detectRunners, type RunnerInfo } from "../lib/run";
import { AGENTS, AGENT_ORDER, type AgentKind } from "../lib/agents";

const SOUNDS: { value: SoundKind; label: string }[] = [
  { value: "chime", label: "Chime" },
  { value: "pluck", label: "Pluck" },
  { value: "bell", label: "Bell" },
];

export function SettingsPopover() {
  const { settings, updateSettings } = useApp();
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState<Record<string, RunnerInfo>>({});

  const setSound = (sound: Settings["sound"]) => {
    updateSettings({ sound });
    if (sound !== "muted") playSound(sound);
  };

  const refresh = (force = false) => {
    const names = AGENT_ORDER.map((k) => AGENTS[k].cmd);
    void detectRunners(names, force)
      .then(setDetected)
      .catch(() => {});
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const setPath = (kind: AgentKind, path: string) => {
    const runnerPaths = { ...settings.runnerPaths };
    if (path.trim()) runnerPaths[kind] = path.trim();
    else delete runnerPaths[kind];
    updateSettings({ runnerPaths });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full rounded-md border border-line bg-base px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
          open ? "text-ink" : "text-muted hover:text-ink"
        }`}
      >
        Alerts
      </button>

      {open && <OverlayMark />}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[75vh] w-[320px] overflow-y-auto rounded-lg border border-line bg-raised p-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="text-[11px] font-medium text-faint">
              Completion sound
            </div>
            <div className="mt-1.5 flex flex-col gap-0.5">
              {SOUNDS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSound(s.value)}
                  className={`flex items-center justify-between rounded px-2 py-1 text-[13px] transition-colors hover:bg-hover ${
                    settings.sound === s.value ? "text-ink" : "text-muted"
                  }`}
                >
                  {s.label}
                  {settings.sound === s.value && (
                    <span className="text-accent">•</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => updateSettings({ sound: "muted" })}
                className={`flex items-center justify-between rounded px-2 py-1 text-[13px] transition-colors hover:bg-hover ${
                  settings.sound === "muted" ? "text-ink" : "text-muted"
                }`}
              >
                Muted
                {settings.sound === "muted" && (
                  <span className="text-accent">•</span>
                )}
              </button>
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <button
                onClick={() =>
                  updateSettings({ notifyEnabled: !settings.notifyEnabled })
                }
                className="flex w-full items-center justify-between rounded px-2 py-1 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                System notifications
                <span
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    settings.notifyEnabled ? "bg-accent" : "bg-line"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink transition-all ${
                      settings.notifyEnabled ? "left-3.5" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-medium text-faint">
                  Agent paths
                </div>
                <button
                  onClick={() => refresh(true)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  Rescan
                </button>
              </div>
              <div className="mt-1.5 flex flex-col gap-2">
                {AGENT_ORDER.map((kind) => {
                  const info = detected[AGENTS[kind].cmd];
                  const override = settings.runnerPaths[kind] ?? "";
                  const overrideActive = !!override;
                  const effective = overrideActive
                    ? override
                    : (info?.path ?? "");
                  return (
                    <div key={kind} className="rounded border border-line bg-base p-2">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-[12px] text-ink">
                          {AGENTS[kind].name}
                        </span>
                        {info?.version && (
                          <span className="truncate text-[10px] tabular-nums text-faint">
                            {info.version}
                          </span>
                        )}
                        {info?.path && (
                          <button
                            onClick={() => setPath(kind, "")}
                            className="ml-auto shrink-0 rounded px-1 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-accent"
                            title="Use the detected binary instead of an override"
                          >
                            Use detected
                          </button>
                        )}
                      </div>
                      <input
                        value={effective}
                        onChange={(e) => setPath(kind, e.target.value)}
                        placeholder={
                          info?.path
                            ? "Override path…"
                            : "Not found — install or set a path…"
                        }
                        spellCheck={false}
                        className="mt-1.5 w-full rounded border border-line bg-base px-2 py-1 font-mono text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent/50"
                      />
                      {overrideActive && (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-[9px] uppercase tracking-wide text-accent">
                            override
                          </span>
                          {info?.path && (
                            <span className="truncate text-[10px] text-faint">
                              detected: {info.path}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
