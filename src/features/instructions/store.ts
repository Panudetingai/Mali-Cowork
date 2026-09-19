import { createStore } from "@/lib/local-store";

/** Reusable know-how the AI applies when a task matches its description. */
export type Skill = {
  id: string;
  name: string;
  /** When to use it; the AI reads this to decide. */
  description: string;
  instructions: string;
  enabled: boolean;
  /** Where it was imported from (a URL or a file), if anywhere. */
  source?: string;
};

/** A project's part of the instructions (see `features/projects`). */
export type ProjectContext = {
  name: string;
  description: string;
  instructions: string;
  skills: Skill[];
};

export type InstructionsState = {
  /** Applied to every chat. */
  custom: string;
  skills: Skill[];
};

const store = createStore<InstructionsState>(
  { custom: "", skills: [] },
  {
    key: "mali_instructions",
    revive: (value) => ({
      custom: typeof value?.custom === "string" ? value.custom : "",
      skills: Array.isArray(value?.skills) ? value.skills : [],
    }),
  },
);

export const useInstructions = store.use;
export const getInstructions = store.get;

export function setCustomInstructions(custom: string) {
  store.set((s) => ({ ...s, custom }));
}

export function saveSkill(skill: Omit<Skill, "id"> & { id?: string }) {
  const id = skill.id ?? crypto.randomUUID();
  store.set((s) => {
    const next = { ...skill, id };
    const exists = s.skills.some((k) => k.id === id);
    return { ...s, skills: exists ? s.skills.map((k) => (k.id === id ? next : k)) : [...s.skills, next] };
  });
  return id;
}

export function toggleSkill(id: string, enabled: boolean) {
  store.set((s) => ({ ...s, skills: s.skills.map((k) => (k.id === id ? { ...k, enabled } : k)) }));
}

export function deleteSkill(id: string) {
  store.set((s) => ({ ...s, skills: s.skills.filter((k) => k.id !== id) }));
}

/** Keeps the system prompt from crowding out the conversation. */
const MAX_CHARS = 12_000;

/**
 * The text every model gets as extra system instructions: the user's own
 * instructions, the project's (if the chat is in one), then each enabled
 * skill. Past the size limit, later skills are listed by name and
 * description only.
 */
export function buildInstructions(state: InstructionsState = store.get(), project?: ProjectContext): string {
  const sections: string[] = [];
  const custom = state.custom.trim();
  if (custom) sections.push(`# Instructions from the user\n${custom}`);

  if (project) {
    const about = [
      `This chat is part of the project “${project.name.trim()}”.`,
      project.description.trim(),
      project.instructions.trim(),
    ].filter(Boolean);
    sections.push(`# Project: ${project.name.trim()}\n${about.join("\n\n")}`);
  }

  const skills = [...(project?.skills ?? []), ...state.skills].filter(
    (k) => k.enabled && k.name.trim() && k.instructions.trim(),
  );
  if (skills.length) {
    let used = sections.join("").length;
    const blocks = skills.map((skill) => {
      const full = `## ${skill.name.trim()}\nUse when: ${skill.description.trim() || "the task calls for it"}\n\n${skill.instructions.trim()}`;
      if (used + full.length <= MAX_CHARS) {
        used += full.length;
        return full;
      }
      return `## ${skill.name.trim()}\nUse when: ${skill.description.trim()} (full instructions omitted: too long)`;
    });
    sections.push(
      `# Skills\nWhen the task matches a skill's "Use when", follow that skill's instructions.\n\n${blocks.join("\n\n")}`,
    );
  }
  return sections.join("\n\n");
}

/** Read a `SKILL.md` (front matter with `name` and `description`, then the instructions). */
export function parseSkillFile(text: string, fallbackName: string): Omit<Skill, "id"> {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/.exec(text.trim());
  const meta = match ? parseFrontMatter(match[1]) : {};
  return {
    name: meta.name || fallbackName.replace(/\.md$/i, ""),
    description: meta.description ?? "",
    instructions: (match ? match[2] : text).trim(),
    enabled: true,
  };
}

/**
 * The flat `key: value` subset of YAML that SKILL.md files use, including
 * quoted values and folded (`>`) or literal (`|`) multi-line values.
 */
function parseFrontMatter(block: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const found = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!found) continue;
    const [, key, raw] = found;
    let value = raw.trim();
    if (/^[>|][-+]?$/.test(value)) {
      const body: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        body.push(lines[++i].trim());
      }
      value = value.startsWith(">") ? body.join(" ").replace(/\s+/g, " ").trim() : body.join("\n").trim();
    } else if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.replace(/^"|"$/g, "");
      }
    } else if (value.startsWith("'")) {
      value = value.replace(/^'|'$/g, "").replace(/''/g, "'");
    }
    meta[key] = value;
  }
  return meta;
}

/** A skill as a `SKILL.md` others can import (here or in other agents). */
export function toSkillFile(skill: Pick<Skill, "name" | "description" | "instructions">): string {
  // JSON strings are valid YAML, so any quotes or colons survive the round trip.
  const front = [`name: ${JSON.stringify(skillSlug(skill))}`, `description: ${JSON.stringify(skill.description.trim())}`];
  const title = skill.name.trim() === skillSlug(skill) ? "" : `# ${skill.name.trim()}\n\n`;
  return `---\n${front.join("\n")}\n---\n\n${title}${skill.instructions.trim()}\n`;
}

/** Read a skill back from `toSkillFile`, keeping its display name from the `#` title. */
export function fromSkillFile(text: string, fallbackName: string): Omit<Skill, "id"> {
  const skill = parseSkillFile(text, fallbackName);
  const title = /^#\s+(.+)\n+/.exec(skill.instructions);
  if (title && skillSlug({ name: title[1] }) === skillSlug(skill)) {
    return { ...skill, name: title[1].trim(), instructions: skill.instructions.slice(title[0].length).trim() };
  }
  return skill;
}

/** Starting points offered in Settings. */
export const SKILL_TEMPLATES: Omit<Skill, "id" | "enabled">[] = [
  {
    name: "Summarize documents",
    description: "The user asks to summarize a file, meeting notes or a long text",
    instructions: [
      "Start with a 2–3 sentence overview.",
      "Then list the key points as short bullets, most important first.",
      "End with decisions, action items (who/what/when) and open questions, if any.",
      "Keep numbers, names and dates exactly as written. Reply in the language of the source.",
    ].join("\n"),
  },
  {
    name: "Careful code changes",
    description: "Editing code or running commands in a project",
    instructions: [
      "Read the relevant files before changing them and follow the project's existing style.",
      "Make the smallest change that solves the task; don't reformat unrelated code.",
      "Run the project's tests or build afterwards when possible, and report the result honestly.",
      "Summarize what changed and why, file by file.",
    ].join("\n"),
  },
  {
    name: "Reply in my language",
    description: "Always",
    instructions: "Reply in the language the user wrote in (Thai stays Thai). Keep technical terms, code and file names in English.",
  },
];

/** How a skill is called from the chat box: `/weekly-report` (or `\weekly-report`). */
export function skillSlug(skill: Pick<Skill, "name">) {
  return skill.name.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Skills called by name in a prompt, in the order they appear. */
export function skillsInPrompt(text: string, skills: Skill[] = store.get().skills): Skill[] {
  const found: Skill[] = [];
  for (const match of text.matchAll(/(?:^|\s)[/\\]([^\s/\\]+)/g)) {
    const slug = match[1].toLowerCase().replace(/[.,;:!?)]+$/, "");
    const skill = skills.find((k) => skillSlug(k) === slug && k.instructions.trim());
    if (skill && !found.includes(skill)) found.push(skill);
  }
  return found;
}

/** Skills ranked for the `/` picker: name prefix first, then anywhere in the name or "use when". */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  return skills
    .map((skill) => {
      const slug = skillSlug(skill);
      const score = !q
        ? 1
        : slug.startsWith(q)
          ? 3
          : slug.includes(q)
            ? 2
            : skill.description.toLowerCase().includes(q)
              ? 1
              : -1;
      return { skill, score };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score || Number(b.skill.enabled) - Number(a.skill.enabled))
    .slice(0, 8)
    .map((s) => s.skill);
}
