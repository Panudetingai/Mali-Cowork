/**
 * Skills in the Agent Skills layout: `skills/<name>/SKILL.md`, its front
 * matter naming and describing it. bot-forge installs a skill by its text
 * (pasted, a file, or a folder holding SKILL.md); nothing in it runs.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { joinFrontMatter, splitFrontMatter } from "./frontmatter";
import { Skill, slugify } from "./schema";

/** A SKILL.md's text as a skill; `fallbackName` when its front matter has no name. */
export function parseSkill(text: string, fallbackName = "skill", source = "pasted"): Skill {
  const { meta, body } = splitFrontMatter(text);
  if (!body.trim()) throw new Error("That skill has no instructions.");
  const firstLine = body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  return Skill.parse({
    name: slugify(meta.name || fallbackName, "skill"),
    description: (meta.description || firstLine).slice(0, 400),
    body,
    source,
  });
}

/** A skill from a SKILL.md file, a folder holding one, or any Markdown file. */
export function readSkill(path: string): Skill {
  if (!existsSync(path)) throw new Error(`No such file or folder: ${path}`);
  const file = statSync(path).isDirectory() ? join(path, "SKILL.md") : path;
  if (!existsSync(file)) throw new Error(`${path} has no SKILL.md.`);
  const name = basename(file).toUpperCase() === "SKILL.MD" ? basename(dirname(file)) : basename(file).replace(/\.md$/i, "");
  return parseSkill(readFileSync(file, "utf8"), name, file);
}

export function skillFile(skill: Skill): string {
  return joinFrontMatter({ name: skill.name, description: skill.description }, skill.body);
}
