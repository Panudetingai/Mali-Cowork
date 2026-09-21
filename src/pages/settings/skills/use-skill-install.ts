import { skillSlug, toSkillFile, type Skill, type SkillCandidate } from "@/features/instructions";
import { installSkills, takenSlugs, toInstallRecord, uniqueSlug } from "@/features/skills";
import { useState } from "react";
import type { SkillDraft } from "./skill-dialog";
import type { InstallChoice } from "./install-skill-dialog";

export type InstallResult = { added: number; updated: number; files: number };

/**
 * Installing skills: write each one's folder, then remember where it landed.
 *
 * A skill replacing one already in the library keeps its folder, so its
 * scripts are refreshed in place rather than piling up beside the old ones.
 */
export function useSkillInstall(onSave: (skill: SkillDraft) => void, existing: Skill[]) {
  const [busy, setBusy] = useState(false);

  const install = async (choices: InstallChoice[]): Promise<InstallResult> => {
    setBusy(true);
    try {
      const taken = new Set(takenSlugs());
      const plan = choices.map(({ candidate, files, replaces }) => {
        const slug = replaces?.install?.slug ?? uniqueSlug(candidate, taken);
        taken.add(slug);
        return { slug, candidate, files, replaces };
      });

      const installed = await installSkills(
        plan.map(({ slug, candidate, files }) => ({ slug, content: toSkillFile(candidate), files })),
      );

      let files = 0;
      for (const { slug, candidate, replaces } of plan) {
        const landed = installed.find((i) => i.slug === slug);
        files += landed?.files.length ?? 0;
        // The manifest describes what was offered, not what the skill is —
        // `install.files` records what actually landed. Keeping it here would
        // park every asset's URL in local storage for nothing.
        const { files: _offered, ...skill } = candidate;
        onSave({
          ...skill,
          id: replaces?.id,
          enabled: replaces?.enabled ?? true,
          install: landed ? toInstallRecord(landed) : undefined,
        });
      }

      const updated = plan.filter((p) => p.replaces).length;
      return { added: plan.length - updated, updated, files };
    } finally {
      setBusy(false);
    }
  };

  /** Which of these are already in the library, by the name they'd take. */
  const alreadyHave = (candidates: SkillCandidate[]) =>
    candidates.filter((c) => existing.some((s) => skillSlug(s) === skillSlug(c))).length;

  return { busy, install, alreadyHave };
}

/** “2 added, 1 updated, 7 files” — what to tell the user afterwards. */
export function describeInstall({ added, updated, files }: InstallResult): string {
  const parts = [
    added > 0 && `${added} added`,
    updated > 0 && `${updated} updated`,
    files > 0 && `${files} file${files === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.length ? `Skills installed: ${parts.join(", ")}.` : "Nothing to install.";
}
