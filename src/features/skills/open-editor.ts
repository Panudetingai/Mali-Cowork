import { createChat } from "@/features/chat-history";
import { fromSkillFile, saveSkill, toSkillFile, type Skill, type SkillDraft } from "@/features/instructions";
import { saveProjectSkill } from "@/features/projects";
import { normalizeFolder, requestFolderAccess } from "@/features/workspace";
import { everySkill, installSkills, takenSlugs, toInstallRecord, uniqueSlug } from "./install";
import { libraryDir } from "./sync";

/**
 * Make sure a skill has a folder on disk, creating one if it doesn't.
 * Returns the skill record (with install info), its slug, and the folder.
 */
export async function ensureSkillFolder(
  skill: Skill | SkillDraft,
  onSave: (skill: SkillDraft) => string,
): Promise<{ skill: Skill; slug: string; dir: string }> {
  const existingId = "id" in skill ? (skill as Skill).id : undefined;
  if (existingId && skill.install) {
    return { skill: skill as Skill, slug: skill.install.slug, dir: skill.install.dir };
  }

  const slug = skill.install?.slug ?? uniqueSlug(skill, takenSlugs());
  const installed = await installSkills([{ slug, content: toSkillFile(skill), files: [] }]);
  const landed = installed[0];
  if (!landed) throw new Error("Could not create skill folder");

  const saved: SkillDraft = {
    ...skill,
    id: existingId,
    enabled: skill.enabled ?? true,
    install: toInstallRecord(landed),
  };
  const id = onSave(saved);
  return { skill: { ...saved, id } as Skill, slug: landed.slug, dir: landed.dir };
}

/** The user didn't allow writing to the skills folder. */
export class SkillsAccessError extends Error {
  constructor() {
    super("Choose “Read & write” to create and edit skills.");
    this.name = "SkillsAccessError";
  }
}

/**
 * Open a skill in the code editor: create/ensure its folder, grant access,
 * start a code-mode chat rooted in the skills library, and pass the file to
 * auto-open.
 */
export async function openSkillEditor(
  navigate: (path: string) => void,
  skill: Skill | SkillDraft,
  onSave: (skill: SkillDraft) => string,
): Promise<void> {
  const dir = await libraryDir();
  const grant = await requestFolderAccess(dir, {
    reason: "Skills are edited as files in this folder.",
    need: "write",
  });
  if (!grant || grant.access !== "write") throw new SkillsAccessError();

  const { slug } = await ensureSkillFolder(skill, onSave);
  const chat = createChat("Skills", { mode: "cowork", view: "code", cwd: normalizeFolder(dir), ephemeral: true });
  const rel = `${slug}/SKILL.md`;
  navigate(`/chat/${chat.id}?mode=code&open=${encodeURIComponent(rel)}`);
}

/** Read every skill on disk and update the store when a SKILL.md has changed. */
export async function updateSkillFromFile(slug: string, text: string): Promise<void> {
  const parsed = fromSkillFile(text, slug);
  const match = everySkill().find(({ skill }) => skill.install?.slug === slug);
  if (!match) return;

  const current = match.skill;
  if (
    current.name === parsed.name &&
    current.description === parsed.description &&
    current.instructions === parsed.instructions
  ) {
    return;
  }

  const next: Skill = { ...current, ...parsed };
  if (match.projectId) saveProjectSkill(match.projectId, next);
  else saveSkill(next);
}
