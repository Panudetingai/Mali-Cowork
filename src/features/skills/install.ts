import { exportSlug, getInstructions, type Skill, type SkillInstall } from "@/features/instructions";
import { getProjects } from "@/features/projects";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledSkill, SkillAsset, SkillPackage } from "./types";

/** Skills in a GitHub repository or folder, or a single SKILL.md at a link. */
export function fetchSkillPackages(url: string) {
  return invoke<SkillPackage[]>("skills_fetch_url", { url });
}

/** Read one bundled file, so it can be looked at before installing. */
export function readSkillAsset(url: string) {
  return invoke<string>("skills_read_asset", { url });
}

/** Where the library lives, for showing the user and granting the agent. */
export function skillsDir() {
  return invoke<string>("skills_dir");
}

/** What is on disk right now. */
export function installedSkills() {
  return invoke<InstalledSkill[]>("skills_installed");
}

export function uninstallSkill(slug: string) {
  return invoke<void>("skills_uninstall", { slug });
}

/**
 * Install skills: write each SKILL.md and download the files the user kept.
 * Files marked `skipped` are left behind.
 */
export async function installSkills(
  skills: { slug: string; content: string; files?: SkillAsset[] }[],
): Promise<InstalledSkill[]> {
  return invoke<InstalledSkill[]>("skills_install", { skills });
}

/** The install record kept on a skill, from what actually landed on disk. */
export function toInstallRecord(installed: InstalledSkill): SkillInstall {
  return {
    slug: installed.slug,
    dir: installed.dir,
    files: installed.files,
    at: new Date().toISOString(),
  };
}

/**
 * A folder name for a skill that no other skill in the library is using, so
 * two "Weekly report"s never overwrite each other on disk.
 */
export function uniqueSlug(skill: Pick<Skill, "name">, taken: Iterable<string>): string {
  const base = exportSlug(skill);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Every folder name already spoken for — across your skills and every
 * project's — so a new skill picks one that is free. Two skills called
 * "Weekly report" must not share a folder.
 */
export function takenSlugs(): string[] {
  return everySkill()
    .map(({ skill }) => skill.install?.slug)
    .filter((slug): slug is string => !!slug);
}

/** Your skills and each project's, tagged with where they came from. */
export function everySkill(): { skill: Skill; projectId?: string }[] {
  return [
    ...getInstructions().skills.map((skill) => ({ skill })),
    ...getProjects().flatMap((project) =>
      project.skills.map((skill) => ({ skill, projectId: project.id })),
    ),
  ];
}
