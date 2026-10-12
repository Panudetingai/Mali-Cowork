/**
 * A bot on disk: a plugin folder in the Claude Code layout, which Mali
 * Cowork installs as it is (Settings › Team › Import bot) and Claude Code loads as a
 * plugin.
 *
 * ```text
 * <slug>/
 * ├── .claude-plugin/plugin.json   name, version, description
 * ├── agents/<slug>.md             the bot: duty, tools, instructions
 * ├── skills/<name>/SKILL.md       its skills
 * ├── .mcp.json                    its connectors (variables, never values)
 * ├── bot.json                     the full spec, for bot-forge
 * └── README.md                    what it does and what it needs
 * ```
 *
 * The agent's `mali-connectors` / `mali-skills` lines tell Mali which of the
 * plugin's connectors and skills are the bot's own (duties never overlap).
 */
import { CATALOG } from "./catalog";
import { joinFrontMatter, listOf, splitFrontMatter } from "./frontmatter";
import { parseSkill, skillFile } from "./skills";
import { BotSpec, Connector, parseSpec, slugify, SPEC_VERSION, ToolScope, now } from "./schema";
import { renderReadme } from "./summary";

/** Relative path → text. */
export type Files = Map<string, string>;

const CLAUDE_TOOLS: Record<ToolScope, string[]> = {
  none: [],
  read: ["Read", "Grep", "Glob"],
  files: ["Read", "Grep", "Glob", "Write", "Edit"],
  all: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"],
};

/** The `tools:` line: Claude Code's tool names plus the bot's MCP servers. */
export function toolsLine(spec: Pick<BotSpec, "tools" | "connectors">): string {
  return [...CLAUDE_TOOLS[spec.tools], ...spec.connectors.map((c) => `mcp__${c.name}`)].join(", ");
}

/** Back from a `tools:` line (Mali's reading, see `toolScopeOf` in features/plugins/convert.ts). */
export function scopeOf(tools: string | undefined): ToolScope {
  const list = listOf(tools?.replace(/\s+/g, ",")).map((t) => t.toLowerCase());
  if (!list.length) return "read";
  if (list.some((t) => t === "bash" || t === "*")) return "all";
  if (list.some((t) => ["write", "edit", "multiedit", "notebookedit"].includes(t))) return "files";
  if (list.some((t) => ["read", "grep", "glob", "ls", "webfetch", "websearch"].includes(t))) return "read";
  return "none";
}

/** A connector as an `.mcp.json` entry. */
export function mcpEntry(c: Connector): Record<string, unknown> {
  const env = Object.fromEntries(c.env.map((v) => [v.var, `\${${v.var}}`]));
  if (c.kind === "remote") {
    return { type: "http", url: c.url, ...(Object.keys(c.headers).length ? { headers: c.headers } : {}) };
  }
  return { command: c.command, args: c.args, ...(Object.keys(env).length ? { env } : {}) };
}

export function toFiles(spec: BotSpec): Files {
  const files: Files = new Map();
  files.set(
    ".claude-plugin/plugin.json",
    json({
      name: spec.slug,
      version: spec.version,
      description: spec.duty,
      ...(spec.author ? { author: { name: spec.author } } : {}),
      keywords: ["bot", "bot-forge"],
    }),
  );
  files.set(
    `agents/${spec.slug}.md`,
    joinFrontMatter(
      {
        name: spec.slug,
        description: spec.duty,
        tools: toolsLine(spec),
        "mali-name": spec.name,
        "mali-connectors": spec.connectors.map((c) => c.name).join(", "),
        "mali-skills": spec.skills.map((s) => s.name).join(", "),
      },
      spec.instructions,
    ),
  );
  for (const skill of spec.skills) files.set(`skills/${skill.name}/SKILL.md`, skillFile(skill));
  if (spec.connectors.length) {
    files.set(".mcp.json", json({ mcpServers: Object.fromEntries(spec.connectors.map((c) => [c.name, mcpEntry(c)])) }));
  }
  files.set("bot.json", json(spec));
  files.set("README.md", renderReadme(spec));
  return files;
}

/**
 * A bot from plugin files: `bot.json` when it's there (checked against the
 * rest), else rebuilt from the plugin's first agent, its skills and its
 * `.mcp.json` — so any Claude Code plugin with an agent comes in too.
 */
export function fromFiles(files: Files): BotSpec {
  const text = files.get("bot.json");
  if (!text) return fromPlugin(files);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("bot.json isn't valid JSON.");
  }
  const studio = fromMaliStudio(value);
  return studio ?? parseSpec(value);
}

/** A bot exported from Mali Cowork's Bot Studio (`mali-bot-*.json`). */
function fromMaliStudio(value: unknown): BotSpec | null {
  const bundle = value as { version?: number; bot?: { name?: unknown; role?: unknown; styleNotes?: unknown; knowledge?: { title?: string; body?: string }[] } };
  if (bundle?.version !== 1 || !bundle.bot || typeof bundle.bot.name !== "string" || typeof bundle.bot.role !== "string") return null;
  const { name, role } = bundle.bot as { name: string; role: string };
  const style = typeof bundle.bot.styleNotes === "string" ? bundle.bot.styleNotes.trim() : "";
  const knowledge = (bundle.bot.knowledge ?? []).filter((k) => k?.title && k?.body).map((k) => `### ${k.title}\n\n${k.body!.trim()}`);
  const at = now();
  return parseSpec({
    specVersion: SPEC_VERSION,
    slug: slugify(name),
    name,
    duty: role.trim() || name,
    instructions: [`You are ${name}. ${role.trim()}`, style && `How you work:\n${style}`, knowledge.length && `What you know:\n\n${knowledge.join("\n\n")}`].filter(Boolean).join("\n\n"),
    tools: "read",
    createdAt: at,
    updatedAt: at,
  });
}

function fromPlugin(files: Files): BotSpec {
  const agentPath = [...files.keys()].filter((p) => /^agents\/[^/]+\.md$/i.test(p)).sort()[0];
  if (!agentPath) throw new Error("This isn't a bot: there's no bot.json and no agents/*.md.");
  const manifest = safeJson(files.get(".claude-plugin/plugin.json")) as { name?: string; version?: string; author?: { name?: string } } | null;
  const { meta, body } = splitFrontMatter(files.get(agentPath)!);
  const agentName = meta.name || agentPath.replace(/^agents\/|\.md$/gi, "");

  const skills = [...files.entries()]
    .filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/i.test(p))
    .map(([p, text]) => parseSkill(text, p.split("/")[1], p));
  const servers = (safeJson(files.get(".mcp.json")) as { mcpServers?: Record<string, Record<string, unknown>> } | null)?.mcpServers ?? {};
  const connectors = Object.entries(servers).map(([name, config]) => connectorFrom(name, config));
  // The agent's own, when it says; otherwise everything the plugin brings.
  const ownC = listOf(meta["mali-connectors"]);
  const ownS = listOf(meta["mali-skills"]);
  const at = now();
  return parseSpec({
    specVersion: SPEC_VERSION,
    slug: slugify(manifest?.name || agentName),
    name: meta["mali-name"] || humanize(agentName),
    duty: meta.description || `${humanize(agentName)}`,
    instructions: body || meta.description || humanize(agentName),
    tools: scopeOf(meta.tools),
    capabilities: [],
    examples: [],
    connectors: ownC.length ? connectors.filter((c) => ownC.includes(c.name)) : connectors,
    skills: ownS.length ? skills.filter((s) => ownS.includes(s.name)) : skills,
    version: manifest?.version ?? "0.1.0",
    ...(manifest?.author?.name ? { author: manifest.author.name } : {}),
    createdAt: at,
    updatedAt: at,
  });
}

const PLACEHOLDER = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/;
const strings = (x: unknown) => (Array.isArray(x) ? x.filter((a): a is string => typeof a === "string") : []);
const record = (x: unknown): Record<string, string> =>
  x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => typeof e[1] === "string")) : {};

function connectorFrom(rawName: string, c: Record<string, unknown>): Connector {
  const name = slugify(rawName, "connector");
  const known = CATALOG.find((e) => e.id === name);
  const base = { name, title: known?.name ?? humanize(rawName), description: known?.description ?? "", ...(known ? { catalogId: known.id } : {}) };
  const url = typeof c.url === "string" ? c.url : typeof c.serverUrl === "string" ? c.serverUrl : undefined;
  if (url) {
    const headers = record(c.headers);
    const vars = Object.values(headers).flatMap((v) => [...v.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    return Connector.parse({ ...base, kind: "remote", url, headers, env: [...new Set(vars)].map((v) => ({ var: v, label: v, secret: true })) });
  }
  const argv = Array.isArray(c.command) ? strings(c.command) : typeof c.command === "string" ? [c.command, ...strings(c.args)] : [];
  if (!argv.length) throw new Error(`The connector "${rawName}" has neither a command nor a URL.`);
  // Values written into the file stay out: only the variables come along.
  const env = Object.keys(record(c.env ?? c.environment)).map((v) => {
    const fromCatalog = known?.env.find((e) => e.var === v);
    return fromCatalog ?? { var: v, label: v, required: true, secret: /key|token|secret|password|auth/i.test(v) };
  });
  return Connector.parse({ ...base, kind: "local", command: argv[0], args: argv.slice(1), env });
}

/** Values a plugin wrote straight into `.mcp.json`, which bot-forge drops on import. */
export function literalSecrets(files: Files): string[] {
  const servers = (safeJson(files.get(".mcp.json")) as { mcpServers?: Record<string, { env?: unknown }> } | null)?.mcpServers ?? {};
  return Object.entries(servers).flatMap(([name, c]) =>
    Object.entries(record(c.env))
      .filter(([, v]) => v.trim() && !PLACEHOLDER.test(v))
      .map(([k]) => `${name}: ${k}`),
  );
}

function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
