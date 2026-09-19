import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { fromSkillFile, skillSlug, toSkillFile, type Skill } from "./store";

/** A `SKILL.md` the backend found (see `commands/storage/skills.rs`). */
type FoundSkill = { source: string; folder: string; content: string };

/** A skill ready to import, with where it came from. */
export type SkillCandidate = Omit<Skill, "id"> & { source: string };

function toCandidates(found: FoundSkill[]): SkillCandidate[] {
  return found
    .map((f) => ({ ...fromSkillFile(f.content, f.folder || "Skill"), source: f.source }))
    .filter((c) => c.name.trim() && c.instructions.trim());
}

/** Skills in a GitHub repository or folder, or a single SKILL.md at any https URL. */
export async function fetchSkillsFromUrl(url: string) {
  return toCandidates(await invoke<FoundSkill[]>("skills_fetch_url", { url }));
}

/** Pick a folder (a shared drive, a cloned repo…) and find its SKILL.md files. */
export async function pickSkillsFolder(): Promise<SkillCandidate[] | null> {
  const folder = await open({ directory: true, multiple: false, title: "Import skills from a folder" });
  if (typeof folder !== "string") return null;
  return toCandidates(await invoke<FoundSkill[]>("skills_scan_folder", { folder }));
}

/** A folder name for a skill that works on every OS. */
export function exportSlug(skill: Pick<Skill, "name">) {
  return (
    skillSlug(skill)
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/^[.\s-]+|[.\s]+$/g, "")
      .slice(0, 60) || "skill"
  );
}

/** Save one skill as a `SKILL.md` file. */
export async function exportSkillFile(skill: Skill): Promise<boolean> {
  const path = await save({
    title: `Export “${skill.name}”`,
    defaultPath: `${exportSlug(skill)}.SKILL.md`,
    filters: [{ name: "Skill (Markdown)", extensions: ["md"] }],
  });
  if (!path) return false;
  await writeTextFile(path, toSkillFile(skill));
  return true;
}

/** Save skills into a folder as `<name>/SKILL.md`, the layout other people and agents import. */
export async function exportSkillsToFolder(skills: Skill[]): Promise<{ folder: string; count: number } | null> {
  const folder = await open({ directory: true, multiple: false, title: "Export skills to a folder" });
  if (typeof folder !== "string") return null;
  const used = new Set<string>();
  const files = skills.map((skill) => {
    let slug = exportSlug(skill);
    for (let n = 2; used.has(slug); n++) slug = `${exportSlug(skill)}-${n}`;
    used.add(slug);
    return { slug, content: toSkillFile(skill) };
  });
  const count = await invoke<number>("skills_export_folder", { folder, skills: files });
  return { folder, count };
}

export async function copySkillFile(skill: Skill) {
  await navigator.clipboard.writeText(toSkillFile(skill));
}
