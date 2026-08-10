import { invoke } from "@tauri-apps/api/core";
import type { ContextBlock } from "../lib/run";
import type { Slice } from "./types";

export type Skill = {
  id: string;
  path: string;
  name: string;
  description: string;
  source: string;
  content: string;
};

export type SkillSlice = {
  skills: Skill[];
  /** Ids attached to composer runs. */
  enabledSkills: string[];
  skillsError: string | null;

  refreshSkills: () => Promise<void>;
  importSkillFile: (path: string) => Promise<void>;
  importSkillUrl: (url: string) => Promise<void>;
  importSkillGit: (url: string) => Promise<void>;
  deleteSkill: (path: string) => Promise<void>;
  saveSkill: (id: string, content: string) => Promise<void>;
  toggleSkill: (id: string) => void;
  skillBlocks: () => ContextBlock[];
};

export const createSkillSlice: Slice<SkillSlice> = (set, get) => {
  const guard = async (fn: () => Promise<unknown>) => {
    set({ skillsError: null });
    try {
      await fn();
      await get().refreshSkills();
    } catch (error) {
      set({ skillsError: String(error) });
    }
  };

  return {
    skills: [],
    enabledSkills: [],
    skillsError: null,

    refreshSkills: async () => {
      const skills = await invoke<Skill[]>("skills_list").catch(() => []);
      set((s) => ({
        skills,
        // Drop ids for skills that no longer exist.
        enabledSkills: s.enabledSkills.filter((id) =>
          skills.some((skill) => skill.id === id),
        ),
      }));
    },

    importSkillFile: (path) => guard(() => invoke("skill_import_file", { path })),
    importSkillUrl: (url) => guard(() => invoke("skill_import_url", { url })),
    importSkillGit: (url) => guard(() => invoke("skill_import_git", { url })),
    deleteSkill: (path) => guard(() => invoke("skill_delete", { path })),
    saveSkill: (id, content) => guard(() => invoke("skill_save", { id, content })),

    toggleSkill: (id) =>
      set((s) => ({
        enabledSkills: s.enabledSkills.includes(id)
          ? s.enabledSkills.filter((x) => x !== id)
          : [...s.enabledSkills, id],
      })),

    /**
     * Skills are concatenated into the prompt as context. They are never
     * executed — a skill is instructions, not code.
     */
    skillBlocks: () => {
      const { skills, enabledSkills } = get();
      return skills
        .filter((s) => enabledSkills.includes(s.id))
        .map((s) => ({ label: `skill/${s.name}`, content: s.content }));
    },
  };
};
