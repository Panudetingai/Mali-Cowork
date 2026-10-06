/**
 * A plugin's parts in Mali's own terms: a slash command becomes a skill you
 * call by name, an agent becomes a bot on the team, a `.mcp.json` entry
 * becomes a connector. Pure, so it's tested without the app.
 */
import { parseSkillFile, type Skill } from "@/features/instructions/store";
import type { CustomMcp } from "@/features/mcp/custom";
import type { McpEnvVar } from "@/features/mcp/catalog";
import type { TeammateDraft, ToolScope } from "@/features/team/store";
import type { CoworkBotId } from "@/features/cowork-bot";
import type { PluginDoc, PluginMcp } from "./types";

type Front = Record<string, string>;

/** The `key: value` lines of a Markdown file's front matter, and the rest. */
export function splitFrontMatter(text: string): { meta: Front; body: string } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/.exec(text.trim());
  if (!match) return { meta: {}, body: text.trim() };
  const meta: Front = {};
  for (const line of match[1].split(/\r?\n/)) {
    const found = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (found) meta[found[1].toLowerCase()] = found[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: match[2].trim() };
}

/** `code-reviewer` → `Code reviewer`. */
export function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

/** A plugin's `/command` as a skill that comes along only when it's called. */
export function commandToSkill(doc: PluginDoc, pluginName: string): Omit<Skill, "id"> {
  const parsed = parseSkillFile(doc.content, doc.name);
  const { meta } = splitFrontMatter(doc.content);
  const name = doc.name.trim().toLowerCase().replace(/\s+/g, "-");
  const hint = meta["argument-hint"];
  const firstLine = parsed.instructions.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  const about = [
    `This is the /${name} command from the ${pluginName} plugin.`,
    `Whatever the user wrote after /${name} is its arguments — wherever these instructions say $ARGUMENTS (or $1, $2…), use that text${hint ? ` (expected: ${hint})` : ""}.`,
  ].join(" ");
  return {
    name,
    description: (meta.description || firstLine).slice(0, 300),
    instructions: `${about}\n\n${parsed.instructions}`,
    enabled: true,
    slashOnly: true,
  };
}

/** Which of Mali's tool scopes an agent's `tools:` list comes to. */
export function toolScopeOf(tools: string | undefined): ToolScope {
  // An agent that doesn't say gets to read: anything more is the user's call.
  if (!tools?.trim()) return "read";
  const list = tools.split(/[,\s]+/).map((t) => t.trim().toLowerCase());
  if (list.some((t) => t === "bash" || t === "*")) return "all";
  if (list.some((t) => ["write", "edit", "multiedit", "notebookedit"].includes(t))) return "files";
  if (list.some((t) => ["read", "grep", "glob", "ls", "webfetch", "websearch"].includes(t))) return "read";
  return "none";
}

/** A short duty from an agent's description, without its worked examples. */
export function dutyOf(description: string): string {
  const plain = description
    .replace(/\\n/g, "\n")
    .replace(/<example>[\s\S]*?<\/example>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= 280) return plain;
  const cut = plain.slice(0, 280);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"));
  return (end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`).trim();
}

/** A plugin's agent as a bot for the team, on `modelId`. */
export function agentToTeammate(
  doc: PluginDoc,
  { modelId, mascot, pluginId }: { modelId: string; mascot: CoworkBotId; pluginId: string },
): TeammateDraft {
  const { meta, body } = splitFrontMatter(doc.content);
  const name = humanize(meta.name || doc.name);
  return {
    name,
    mascot,
    role: dutyOf(meta.description || `${name} from a plugin`) || name,
    instructions: body,
    modelId,
    skills: [],
    connectors: [],
    tools: toolScopeOf(meta.tools),
    // Brought by a plugin, not taken on by the user: the lead asks first.
    onTeam: false,
    plugin: pluginId,
  };
}

/** `${API_KEY}` or `${API_KEY:-default}` in a value: the variable it names. */
const PLACEHOLDER = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/;

function quote(arg: string) {
  return /[\s"']/.test(arg) ? `"${arg.replace(/"/g, "")}"` : arg;
}

const strings = (x: unknown) => (Array.isArray(x) ? x.filter((a): a is string => typeof a === "string") : []);
const record = (x: unknown): Record<string, string> =>
  x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => typeof e[1] === "string"))
    : {};

/** A plugin's MCP server as a connector, with the settings it needs from the user. */
export function mcpToConnector(
  server: PluginMcp,
  { id, pluginId, pluginName }: { id: string; pluginId: string; pluginName: string },
): { connector: CustomMcp; env: Record<string, string> } {
  const c = server.config;
  const url = typeof c.url === "string" ? c.url : typeof c.serverUrl === "string" ? c.serverUrl : undefined;
  const base = {
    id,
    name: humanize(server.name),
    description: `From the ${pluginName} plugin`,
    createdAt: Date.now(),
    plugin: pluginId,
  };
  if (url) {
    return { connector: { ...base, kind: "remote", url, headers: record(c.headers) }, env: {} };
  }
  const argv = Array.isArray(c.command)
    ? strings(c.command)
    : typeof c.command === "string"
      ? [c.command, ...strings(c.args)]
      : [];
  const env: Record<string, string> = {};
  const envVars: McpEnvVar[] = [];
  for (const [key, value] of Object.entries(record(c.env ?? c.environment))) {
    if (PLACEHOLDER.test(value) || !value.trim()) {
      envVars.push({
        var: key,
        label: humanize(key.toLowerCase()),
        required: true,
        secret: /key|token|secret|password|auth/i.test(key),
      });
    } else {
      env[key] = value;
    }
  }
  return {
    connector: {
      ...base,
      kind: "local",
      command: argv.map(quote).join(" "),
      ...(envVars.length ? { envVars } : {}),
    },
    env,
  };
}
