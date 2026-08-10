import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp, type Skill } from "../../store/app";
import { OverlayMark } from "../../lib/useOverlay";

/**
 * Skills are markdown instruction files attached to a run's prompt. They are
 * never executed — a skill is text handed to the model, nothing more.
 */
export function SkillsPanel() {
  const [open_, setOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [mode, setMode] = useState<"url" | "git">("url");
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  const {
    skills,
    enabledSkills,
    skillsError,
    refreshSkills,
    importSkillFile,
    importSkillUrl,
    importSkillGit,
    deleteSkill,
    toggleSkill,
  } = useApp();

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const runImport = async () => {
    const value = importUrl.trim();
    if (!value) return;
    setBusy(true);
    if (mode === "git") await importSkillGit(value);
    else await importSkillUrl(value);
    setBusy(false);
    setImportUrl("");
  };

  const pickFile = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (typeof picked === "string") await importSkillFile(picked);
  };

  return (
    <div className="relative">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] transition-colors hover:bg-hover ${
          open_ ? "text-ink" : "text-muted"
        }`}
      >
        Skills
        {enabledSkills.length > 0 && (
          <span className="ml-auto text-[10px] tabular-nums text-accent">
            {enabledSkills.length}
          </span>
        )}
      </button>

      {open_ && <OverlayMark />}
      {open_ && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-72 rounded border border-line bg-raised shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="border-b border-line px-3 py-2">
              <p className="text-[11px] leading-relaxed text-faint">
                Enabled skills are added to every composer run as instructions.
              </p>
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {skills.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-faint">
                  No skills yet. Import one below.
                </p>
              )}
              {skills.map((skill) => (
                <SkillRow
                  key={skill.path}
                  skill={skill}
                  enabled={enabledSkills.includes(skill.id)}
                  onToggle={() => toggleSkill(skill.id)}
                  onDelete={() => {
                    if (window.confirm(`Remove "${skill.name}" from the library?`)) {
                      void deleteSkill(skill.path);
                    }
                  }}
                />
              ))}
            </div>

            <div className="border-t border-line p-2">
              <div className="flex items-center gap-1 pb-1.5">
                {(["url", "git"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                      mode === m
                        ? "bg-hover text-ink"
                        : "text-faint hover:bg-hover hover:text-muted"
                    }`}
                  >
                    {m === "url" ? "URL" : "Git repo"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void pickFile()}
                  className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  From file…
                </button>
              </div>
              <div className="flex items-center gap-1">
                <input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runImport();
                  }}
                  placeholder={
                    mode === "git"
                      ? "https://github.com/user/skills"
                      : "https://…/skill.md"
                  }
                  className="h-6 min-w-0 flex-1 rounded border border-line bg-base px-1.5 text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent/50"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => void runImport()}
                  disabled={busy || !importUrl.trim()}
                  className="shrink-0 rounded px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-hover disabled:text-faint"
                >
                  {busy ? "…" : "Add"}
                </button>
              </div>
              {skillsError && (
                <p className="pt-1.5 text-[10px] leading-relaxed text-[#d47a5c]">
                  {skillsError}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SkillRow({
  skill,
  enabled,
  onToggle,
  onDelete,
}: {
  skill: Skill;
  enabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-hover">
      <input
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        className="mt-0.5 h-3 w-3 shrink-0 accent-[#c98f52]"
      />
      <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[12px] text-ink">{skill.name}</span>
        {skill.description && (
          <span className="block truncate text-[10px] text-faint">
            {skill.description}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Remove"
        className="shrink-0 rounded px-1 text-[11px] text-faint opacity-0 transition-opacity focus-visible:opacity-100 hover:text-[#d47a5c] group-hover:opacity-100 group-focus-within:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
