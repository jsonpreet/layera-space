import { useState } from "react";
import { useApp, type Settings } from "../store/app";
import { playSound, type SoundKind } from "../lib/sound";

const SOUNDS: { value: SoundKind; label: string }[] = [
  { value: "chime", label: "Chime" },
  { value: "pluck", label: "Pluck" },
  { value: "bell", label: "Bell" },
];

export function SettingsPopover() {
  const { settings, updateSettings } = useApp();
  const [open, setOpen] = useState(false);

  const setSound = (sound: Settings["sound"]) => {
    updateSettings({ sound });
    if (sound !== "muted") playSound(sound);
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

      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-[224px] rounded-lg border border-line bg-raised p-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
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
          </div>
        </>
      )}
    </div>
  );
}
