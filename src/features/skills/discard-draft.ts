import { deleteSkill } from "@/features/instructions";
import { everySkill, uninstallSkill } from "./install";

/** Remove a skill folder and its app record when the user abandons a draft. */
export async function discardSkillDraft(slug: string) {
  await uninstallSkill(slug).catch(() => undefined);
  const match = everySkill().find(({ skill }) => skill.install?.slug === slug);
  if (match && !match.projectId) deleteSkill(match.skill.id);
}
