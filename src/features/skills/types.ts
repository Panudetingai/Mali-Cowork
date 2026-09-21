/**
 * What the backend reports about a skill it found, before anything is
 * installed. Kept apart from the code so both the library and the importer
 * can name these without importing each other.
 */

/** One file beside a SKILL.md (see `commands/storage/skills`). */
export type SkillAsset = {
  /** Where it goes inside the skill folder, e.g. `scripts/build.py`. */
  path: string;
  bytes: number;
  /** Where to read it from: an https URL or a path on this Mac. */
  url: string;
  /** Set when it won't be installed, and why. */
  skipped?: string;
};

/** A skill found in a repository or folder, ready to preview and install. */
export type SkillPackage = {
  source: string;
  folder: string;
  content: string;
  files: SkillAsset[];
};

/** A skill folder as it sits on disk. */
export type InstalledSkill = {
  slug: string;
  dir: string;
  files: string[];
  bytes: number;
};
