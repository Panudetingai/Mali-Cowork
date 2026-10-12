/** Changes to a bot, the same from the terminal and the web page. Each returns a new spec. */
import { catalogEntry, customConnector, fromCatalog } from "./catalog";
import { parseSkill } from "./skills";
import { BotSpec, Connector, Skill, ToolScope, uniqueSlug } from "./schema";

export type ConnectorInput =
  | { catalogId: string }
  | { url: string; name?: string; title?: string; description?: string; headers?: Record<string, string>; env?: string[] }
  | { command: string; name?: string; title?: string; description?: string; env?: string[] };

export function toConnector(input: ConnectorInput): Connector {
  if ("catalogId" in input) {
    const entry = catalogEntry(input.catalogId);
    if (!entry) throw new Error(`"${input.catalogId}" isn't in the catalog. See \`bot-forge catalog\`, or add it by --url or --command.`);
    return fromCatalog(entry);
  }
  return customConnector(input);
}

export function addConnector(spec: BotSpec, input: ConnectorInput): { spec: BotSpec; connector: Connector } {
  const connector = toConnector(input);
  if ("catalogId" in input && spec.connectors.some((c) => c.catalogId === connector.catalogId)) {
    throw new Error(`${spec.name} already has ${connector.title}.`);
  }
  const named = { ...connector, name: uniqueSlug(connector.name, spec.connectors.map((c) => c.name)) };
  return { spec: { ...spec, connectors: [...spec.connectors, named] }, connector: named };
}

export function removeConnector(spec: BotSpec, name: string): BotSpec {
  if (!spec.connectors.some((c) => c.name === name)) throw new Error(`${spec.name} has no connector called ${name}.`);
  return { ...spec, connectors: spec.connectors.filter((c) => c.name !== name) };
}

export function addSkill(spec: BotSpec, skill: Skill): BotSpec {
  // The same name again replaces it: that's how a skill is updated.
  return { ...spec, skills: [...spec.skills.filter((s) => s.name !== skill.name), skill] };
}

export function addSkillText(spec: BotSpec, text: string, fallbackName?: string): { spec: BotSpec; skill: Skill } {
  const skill = parseSkill(text, fallbackName ?? "skill");
  return { spec: addSkill(spec, skill), skill };
}

export function removeSkill(spec: BotSpec, name: string): BotSpec {
  if (!spec.skills.some((s) => s.name === name)) throw new Error(`${spec.name} has no skill called ${name}.`);
  return { ...spec, skills: spec.skills.filter((s) => s.name !== name) };
}

export type Fields = Partial<Pick<BotSpec, "name" | "duty" | "instructions" | "tools" | "capabilities" | "examples" | "version" | "author">>;

export function updateFields(spec: BotSpec, fields: Fields): BotSpec {
  const next = { ...spec };
  if (fields.name !== undefined) next.name = required(fields.name, "name");
  if (fields.duty !== undefined) next.duty = required(fields.duty, "duty");
  if (fields.instructions !== undefined) next.instructions = required(fields.instructions, "instructions");
  if (fields.tools !== undefined) next.tools = ToolScope.parse(fields.tools);
  if (fields.capabilities !== undefined) next.capabilities = fields.capabilities.map((c) => c.trim()).filter(Boolean);
  if (fields.examples !== undefined) next.examples = fields.examples.map((c) => c.trim()).filter(Boolean);
  if (fields.version !== undefined) next.version = required(fields.version, "version");
  if (fields.author !== undefined) next.author = fields.author.trim() || undefined;
  return next;
}

function required(value: string, what: string) {
  const v = value.trim();
  if (!v) throw new Error(`The ${what} can't be empty.`);
  return v;
}
