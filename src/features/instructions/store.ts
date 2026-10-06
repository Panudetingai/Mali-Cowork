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
  /** The catalogue it was found through, when it wasn't found directly. */
  via?: "smithery";
  /** Where it lives on disk once installed (see `features/skills`). */
  install?: SkillInstall;
  /** The plugin that brought it (see `features/plugins`). */
  plugin?: string;
  /**
   * Called by name only (`/name`) — a plugin's slash command. It isn't
   * listed in every prompt, and while it's off it can't be called either.
   */
  slashOnly?: boolean;
};

/** A skill's folder in the library, written by `skills_install`/`skills_sync`. */
export type SkillInstall = {
  /** The folder's name, unique across the library. */
  slug: string;
  /** The absolute folder — what the agent is pointed at. */
  dir: string;
  /** Scripts, references and assets beside SKILL.md, relative to `dir`. */
  files: string[];
  /** ISO date of the last install. */
  at: string;
};

/** A skill being created or edited; the id is absent until it is saved. */
export type SkillDraft = Omit<Skill, "id"> & { id?: string };

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
/** For code outside React, e.g. keeping the skill library on disk in step. */
export const subscribeToInstructions = store.subscribe;

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
 * More instructions from elsewhere — a plugin's, while it's on. Registered
 * rather than imported, since what provides them depends on this module.
 */
const extraSources = new Set<() => string | undefined>();

export function addInstructionSource(source: () => string | undefined): () => void {
  extraSources.add(source);
  return () => void extraSources.delete(source);
}

/** A skill that can be called right now. */
function callable(skill: Skill) {
  return !skill.slashOnly || skill.enabled;
}

const USE_WHEN = "the task calls for it";

/**
 * The text every model gets as extra system instructions: the user's own
 * instructions, the project's (if the chat is in one), then its skills.
 *
 * In Cowork the agent has file tools, so a skill installed on disk is listed
 * by name, "Use when" and path — the agent opens the file when a task
 * actually matches. A library of fifty skills then costs a few lines instead
 * of fifty guides, and a skill can be longer than a prompt has room for.
 * In Chat there are no file tools, so the text has to travel with the prompt,
 * and past the size limit later skills keep only their "Use when".
 */
export function buildInstructions(
  state: InstructionsState = store.get(),
  project?: ProjectContext,
  mode: "chat" | "cowork" = "cowork",
): string {
  const sections: string[] = [];
  const custom = state.custom.trim();
  if (custom) sections.push(`# Instructions from the user\n${custom}`);

  for (const source of extraSources) {
    const text = source()?.trim();
    if (text) sections.push(text);
  }

  if (project) {
    const about = [
      `This chat is part of the project “${project.name.trim()}”.`,
      project.description.trim(),
      project.instructions.trim(),
    ].filter(Boolean);
    sections.push(`# Project: ${project.name.trim()}\n${about.join("\n\n")}`);
  }

  // Slash commands come along only when they're called (see `skillsInPrompt`).
  const skills = [...(project?.skills ?? []), ...state.skills].filter(
    (k) => k.enabled && !k.slashOnly && k.name.trim() && k.instructions.trim(),
  );
  if (skills.length === 0) return sections.join("\n\n");

  // On disk the agent can read them; otherwise the text has to come along.
  const onDisk = mode === "cowork" ? skills.filter((k) => k.install) : [];
  const inline = skills.filter((k) => !onDisk.includes(k));
  const blocks: string[] = [];

  if (onDisk.length) {
    blocks.push(
      [
        "Each of these is a folder holding a SKILL.md, and some bring scripts and",
        "reference files with them. When a task matches a skill's “Use when”, read",
        "its SKILL.md first and follow it — read the file, don't guess what it says.",
        "Leave the ones that don't apply alone.",
      ].join(" "),
      onDisk.map(skillEntry).join("\n"),
    );
  }

  if (inline.length) {
    let used = sections.join("").length + blocks.join("").length;
    blocks.push(
      inline
        .map((skill) => {
          const head = `## ${skill.name.trim()}\nUse when: ${skill.description.trim() || USE_WHEN}`;
          const full = `${head}\n\n${skill.instructions.trim()}`;
          if (used + full.length > MAX_CHARS) return `${head}\n(too long to include here)`;
          used += full.length;
          return full;
        })
        .join("\n\n"),
    );
  }

  sections.push(`# Skills\n${blocks.join("\n\n")}`);
  return sections.join("\n\n");
}

/** One installed skill, as the agent sees it before opening anything. */
function skillEntry(skill: Skill): string {
  const lines = [
    `- ${skill.name.trim()} — use when: ${skill.description.trim() || USE_WHEN}`,
    `  ${skill.install?.dir}/SKILL.md`,
  ];
  const files = skill.install?.files ?? [];
  if (files.length) {
    const shown = files.slice(0, 6).join(", ");
    lines.push(`  also has: ${shown}${files.length > 6 ? `, and ${files.length - 6} more` : ""}`);
  }
  return lines.join("\n");
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
    const skill = skills.find((k) => skillSlug(k) === slug && k.instructions.trim() && callable(k));
    if (skill && !found.includes(skill)) found.push(skill);
  }
  return found;
}

/** Skills ranked for the `/` picker: name prefix first, then anywhere in the name or "use when". */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  return skills
    .filter(callable)
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
