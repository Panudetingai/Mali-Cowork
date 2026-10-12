/**
 * A bot, as bot-forge keeps it: one duty, the instructions that carry it out,
 * the connectors (MCP servers) and skills it owns, and what it can do. On
 * disk it is a plugin folder (see `plugin.ts`); `bot.json` holds this spec.
 *
 * No secrets live here: a connector names the variables it needs and the
 * values come from the environment where the bot runs.
 */
import { z } from "zod";

export const SPEC_VERSION = 1;

/** Which file and command tools the bot gets (Mali's tool scopes). */
export const ToolScope = z.enum(["none", "read", "files", "all"]);
export type ToolScope = z.infer<typeof ToolScope>;

export const TOOL_SCOPE_TEXT: Record<ToolScope, string> = {
  none: "Works through its connectors only, no files",
  read: "Reads files, changes nothing",
  files: "Reads and writes files",
  all: "Reads and writes files, and runs commands",
};

/** A variable a connector needs, e.g. an API token. */
export const EnvVar = z.object({
  var: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Variable names are letters, digits and _"),
  label: z.string().default(""),
  required: z.boolean().default(true),
  secret: z.boolean().default(false),
});
export type EnvVar = z.infer<typeof EnvVar>;

const connectorBase = {
  /** Its key in `.mcp.json`; tools read `<name>_<tool>` in Mali, `mcp__<name>__<tool>` in Claude Code. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Connector names are lower-case letters, digits and -"),
  title: z.string(),
  description: z.string().default(""),
  /** The catalog entry it came from, if any. */
  catalogId: z.string().optional(),
  env: z.array(EnvVar).default([]),
};

export const Connector = z.discriminatedUnion("kind", [
  z.object({ ...connectorBase, kind: z.literal("local"), command: z.string().min(1), args: z.array(z.string()).default([]) }),
  z.object({
    ...connectorBase,
    kind: z.literal("remote"),
    url: z.string().url(),
    /** Header values may name variables: `Bearer ${API_TOKEN}`. */
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);
export type Connector = z.infer<typeof Connector>;

export const Skill = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Skill names are lower-case letters, digits and -"),
  description: z.string(),
  /** The SKILL.md body: what to do, step by step. */
  body: z.string().min(1),
  /** Where it came from: a path, a URL, or "generated". */
  source: z.string().default("generated"),
});
export type Skill = z.infer<typeof Skill>;

export const BotSpec = z.object({
  specVersion: z.literal(SPEC_VERSION).default(SPEC_VERSION),
  /** Folder and plugin name. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** Its one duty, in a sentence: a lead picks bots by it. */
  duty: z.string().min(1),
  /** How it does the work: steps, style, what it hands back. */
  instructions: z.string().min(1),
  tools: ToolScope.default("read"),
  /** What it can do, in plain words, one per line. */
  capabilities: z.array(z.string()).default([]),
  /** Requests it is good at, to show what to ask it. */
  examples: z.array(z.string()).default([]),
  connectors: z.array(Connector).default([]),
  skills: z.array(Skill).default([]),
  version: z.string().default("0.1.0"),
  author: z.string().optional(),
  /** The description it was made from, and with what. */
  origin: z
    .object({ prompt: z.string(), provider: z.string(), model: z.string(), at: z.string() })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BotSpec = z.infer<typeof BotSpec>;

/** A spec that passes the schema and the rules the schema can't say. */
export function parseSpec(value: unknown): BotSpec {
  const spec = BotSpec.parse(value);
  const problems = specProblems(spec);
  if (problems.length) throw new Error(problems.join("\n"));
  return spec;
}

export function specProblems(spec: BotSpec): string[] {
  const problems: string[] = [];
  const dupes = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);
  for (const name of new Set(dupes(spec.connectors.map((c) => c.name)))) problems.push(`Two connectors are named "${name}".`);
  for (const name of new Set(dupes(spec.skills.map((s) => s.name)))) problems.push(`Two skills are named "${name}".`);
  return problems;
}

/** `Email Manager!` → `email-manager`. */
export function slugify(text: string, fallback = "bot"): string {
  const slug = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/** `slug`, or `slug-2`, `slug-3`… when it is taken. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export const now = () => new Date().toISOString();
