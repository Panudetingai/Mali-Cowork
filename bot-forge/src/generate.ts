/**
 * From a description to a bot: a model writes the bot's duty, instructions,
 * capabilities and any skills it needs, and picks connectors from the
 * catalog.
 *
 * Any provider (see `providers.ts`): Claude through the official SDK with
 * structured output, or any OpenAI-compatible server — hosted or on this
 * computer. Small and local models get help: a forgiving reading of their
 * JSON, and one chance to fix an answer that isn't a bot design.
 *
 * Which provider and model: `--provider`/`--model` > what was picked with
 * `bot-forge use` or the web page > `BOT_FORGE_PROVIDER`/`BOT_FORGE_MODEL` >
 * the provider's default. Keys come from the environment (each provider's
 * own variable, e.g. `GROQ_API_KEY`), or the web page for that session only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CATALOG, catalogEntry, fromCatalog } from "./catalog";
import { preset, PRESETS, type ProviderKind } from "./providers";
import { BotSpec, parseSpec, slugify, SPEC_VERSION, now, Skill, ToolScope } from "./schema";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export type GeneratorConfig = {
  /** A preset id (`anthropic`, `groq`, `ollama`, `custom`…). */
  provider: string;
  kind: ProviderKind;
  /** Empty until one is picked (only Anthropic has a default). */
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

/** What `bot-forge use` and the web page remember (never a key). */
export type SavedChoice = { provider?: string; model?: string; baseUrl?: string };

export type ConfigInput = Partial<Pick<GeneratorConfig, "provider" | "model" | "apiKey" | "baseUrl">>;

export function generatorConfig(flags: ConfigInput = {}, env: Record<string, string | undefined> = process.env, saved: SavedChoice = {}): GeneratorConfig {
  const provider = (flags.provider ?? saved.provider ?? env.BOT_FORGE_PROVIDER ?? "anthropic").trim().toLowerCase();
  const p = preset(provider);
  // A saved model or address belongs to the provider it was saved with.
  const mine = saved.provider === p.id ? saved : {};
  const model = (flags.model ?? mine.model ?? env.BOT_FORGE_MODEL ?? p.defaultModel ?? "").trim();
  const apiKey = flags.apiKey || (p.keyEnv ? env[p.keyEnv] : undefined) || env.BOT_FORGE_API_KEY || undefined;
  if (p.kind === "anthropic") {
    return { provider: p.id, kind: p.kind, model, apiKey, baseUrl: flags.baseUrl ?? mine.baseUrl };
  }
  const openaiUrl = p.id === "openai" || p.id === "custom" ? env.OPENAI_BASE_URL : undefined;
  const baseUrl = (flags.baseUrl ?? mine.baseUrl ?? env.BOT_FORGE_BASE_URL ?? openaiUrl ?? p.baseUrl ?? "").trim().replace(/\/+$/, "");
  return { provider: p.id, kind: p.kind, model, apiKey, baseUrl };
}

/** What's still missing before this config can design a bot, in words; null when it can. */
export function configProblem(config: GeneratorConfig): string | null {
  const p = preset(config.provider);
  if (config.kind === "openai" && !config.baseUrl) return "Give the server's address (its API root, e.g. http://localhost:8000/v1).";
  if (!config.model) return `Pick a model for ${p.label}: \`bot-forge models --provider ${p.id}\` lists them.`;
  if (config.kind === "openai" && !p.local && !config.apiKey && p.id !== "custom") return `Set ${p.keyEnv} (the ${p.label} API key).`;
  return null;
}

/** Text from whatever a model put there: a string, a number, or an object with a name. */
const text = z.preprocess((v) => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return [o.id, o.name, o.text, o.title, o.description].find((x) => typeof x === "string") ?? "";
  }
  return "";
}, z.string());
const texts = z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []), z.array(text));

/**
 * What the model writes. Claude's structured output always fills every field;
 * smaller models often skip some, so only what a bot can't do without is
 * required and the rest has a sensible default.
 */
export const Draft = z.object({
  name: text.default(""),
  slug: text.default(""),
  duty: text.default(""),
  instructions: text.refine((v) => v.trim().length > 0, "instructions are empty"),
  tools: ToolScope.catch("read"),
  capabilities: texts.default([]),
  examples: texts.default([]),
  connectors: texts.default([]),
  skills: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ name: text.default(""), description: text.default(""), body: text.default("") }).catch({ name: "", description: "", body: "" })))
    .default([]),
  notes: text.default(""),
});
export type Draft = z.infer<typeof Draft>;

/** `Draft` as JSON Schema, within what structured outputs accept (closed objects, no length limits). */
export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "slug", "duty", "instructions", "tools", "capabilities", "examples", "connectors", "skills", "notes"],
  properties: {
    name: { type: "string", description: "Short display name, in the language the user wrote in." },
    slug: { type: "string", description: "lower-case-english-words-with-dashes, from the name." },
    duty: { type: "string", description: "Its one duty, in one sentence." },
    instructions: { type: "string", description: "How it works: steps, style, rules, what it hands back. Markdown." },
    tools: { type: "string", enum: ["none", "read", "files", "all"] },
    capabilities: { type: "array", items: { type: "string" } },
    examples: { type: "array", items: { type: "string" } },
    connectors: { type: "array", items: { type: "string" }, description: "Catalog ids only." },
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "body"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
        },
      },
    },
    notes: { type: "string", description: "What the user should add or set up that the catalog doesn't cover; empty if nothing." },
  },
} as const;

export function systemPrompt(): string {
  const catalog = CATALOG.map((c) => `- ${c.id}: ${c.name} — ${c.description}${c.env.length ? ` (needs ${c.env.map((v) => v.var).join(", ")})` : ""}`).join("\n");
  return `You design AI agent "bots" from a user's description. Each bot has exactly one duty; if the description asks for several unrelated jobs, design the bot for the main one and say in "notes" which other bots would cover the rest.

Write:
- name: a short name people would call it, in the user's language; slug: the same idea in lower-case English words joined by dashes.
- duty: one sentence saying what it is for. A lead agent picks bots by this sentence, so make it specific.
- instructions: what the bot does, step by step, how it should behave, what it must never do, and the shape of what it hands back. Write them to the bot ("You …"), in Markdown, concise and concrete. Include safety rules wherever the bot changes or deletes things (confirm before destructive actions, prefer reversible ones).
- tools: the least access that does the job — "none" (works only through its connectors), "read" (reads files), "files" (writes files), "all" (also runs commands).
- capabilities: 3–8 plain sentences, each one thing it can do.
- examples: 3–5 requests a user might give it, in the user's language.
- connectors: ids from the catalog below that the duty needs, and nothing else. Never invent ids. If it needs a service the catalog doesn't have (for example Gmail or Notion), leave it out and say in notes which MCP server to add.
- skills: only reusable procedures worth keeping apart from the instructions (a checklist, a report format, a workflow); usually zero to two. name: lower-case-with-dashes; body: the procedure in Markdown.

Connector catalog:
${catalog}`;
}

/** A model's draft as a bot: checked, with connectors resolved from the catalog. */
export function draftToSpec(draft: Draft, origin: { prompt: string; provider: string; model: string }): { spec: BotSpec; unknownConnectors: string[]; notes: string } {
  const unknownConnectors: string[] = [];
  const connectors = [...new Set(draft.connectors.map((c) => c.trim().toLowerCase()))].flatMap((id) => {
    const entry = catalogEntry(id);
    if (!entry) unknownConnectors.push(id);
    return entry ? [fromCatalog(entry)] : [];
  });
  const skills: Skill[] = [];
  for (const s of draft.skills) {
    const name = slugify(s.name, "skill");
    if (!s.body.trim() || skills.some((k) => k.name === name)) continue;
    skills.push({ name, description: s.description.trim(), body: s.body.trim(), source: "generated" });
  }
  const at = now();
  const spec = parseSpec({
    specVersion: SPEC_VERSION,
    slug: slugify(draft.slug || draft.name),
    name: draft.name.trim() || "New bot",
    duty: draft.duty.trim() || draft.capabilities[0]?.trim() || draft.name.trim() || "A bot",
    instructions: draft.instructions.trim(),
    tools: draft.tools,
    capabilities: draft.capabilities.map((c) => c.trim()).filter(Boolean),
    examples: draft.examples.map((e) => e.trim()).filter(Boolean),
    connectors,
    skills,
    origin: { ...origin, at },
    createdAt: at,
    updatedAt: at,
  });
  return { spec, unknownConnectors, notes: draft.notes.trim() };
}

export type Generated = { spec: BotSpec; unknownConnectors: string[]; notes: string };

export type Deps = { anthropic?: Anthropic; fetch?: typeof fetch };

export async function generateBot(prompt: string, config: GeneratorConfig, deps: Deps = {}): Promise<Generated> {
  const description = prompt.trim();
  if (!description) throw new Error("Describe the bot you want first.");
  const problem = configProblem(config);
  if (problem) throw new Error(problem);
  const draft = config.kind === "openai" ? await viaOpenAI(description, config, deps.fetch ?? fetch) : await viaClaude(description, config, deps.anthropic);
  return draftToSpec(draft, { prompt: description, provider: config.provider, model: config.model });
}

function anthropicClient(config: GeneratorConfig, client?: Anthropic) {
  return client ?? new Anthropic({ ...(config.apiKey ? { apiKey: config.apiKey } : {}), ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) });
}

/** Models that take `effort`, and those that take server-side refusal fallback (`fallbacks: "default"`). */
const EFFORT = /^claude-(fable-5|mythos-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-5-5)/;
const FALLBACK = /^claude-(fable-5-1|opus-5-5|opus-5$|sonnet-5-5)/;

/** The request options a Claude model accepts: older and smaller ones take fewer. */
export function claudeOptions(model: string) {
  return {
    ...(FALLBACK.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { ...(EFFORT.test(model) ? { effort: "medium" as const } : {}), format: { type: "json_schema" as const, schema: DRAFT_SCHEMA } },
  };
}

async function viaClaude(description: string, config: GeneratorConfig, client?: Anthropic): Promise<Draft> {
  const anthropic = anthropicClient(config, client);
  let response;
  try {
    response = await anthropic.beta.messages.create({
      model: config.model,
      max_tokens: 16000,
      system: systemPrompt(),
      messages: [{ role: "user", content: `Design a bot for this:\n\n${description}` }],
      // A declined request is retried server-side on the model Anthropic recommends for it, where the model takes it.
      ...claudeOptions(config.model),
    });
  } catch (error) {
    throw new Error(describeClaudeError(error));
  }
  if (response.stop_reason === "refusal") throw new Error("The model declined to design this bot. Try describing it differently.");
  if (response.stop_reason === "max_tokens") throw new Error("The bot's design came back cut off. Try a shorter description.");
  return parseDraft(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
}

function describeClaudeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic didn't accept the API key. Set ANTHROPIC_API_KEY (or run `ant auth login`).";
  if (error instanceof Anthropic.PermissionDeniedError) return `This key can't use that model: ${error.message}`;
  if (error instanceof Anthropic.NotFoundError) return `Unknown model. Pick one from \`bot-forge models\`. (${error.message})`;
  if (error instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Wait a moment and try again.";
  if (error instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `Anthropic API error${error.status ? ` ${error.status}` : ""}: ${error.message}`;
  if (error instanceof Error && /api key|apiKey|authentication/i.test(error.message)) {
    return "No Anthropic credentials. Set ANTHROPIC_API_KEY, or run `ant auth login`.";
  }
  return error instanceof Error ? error.message : String(error);
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function headersFor(config: GeneratorConfig): Record<string, string> {
  return { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) };
}

/** Where a fetch failed, in words a person can act on. */
function unreachable(config: GeneratorConfig, error: unknown): Error {
  const p = preset(config.provider);
  const hint = p.local ? ` Is ${p.label.replace(/ \(.*\)$/, "")} running?` : "";
  return new Error(`Couldn't reach ${config.baseUrl}.${hint} (${error instanceof Error ? error.message : String(error)})`);
}

/**
 * One chat completion's text. JSON mode first; a server that doesn't offer
 * it (many local ones) is asked again without.
 */
async function complete(config: GeneratorConfig, messages: ChatMessage[], fetcher: typeof fetch): Promise<string> {
  const send = async (json: boolean) => {
    try {
      return await fetcher(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headersFor(config),
        body: JSON.stringify({ model: config.model, messages, max_tokens: 8000, ...(json ? { response_format: { type: "json_object" } } : {}) }),
      });
    } catch (error) {
      throw unreachable(config, error);
    }
  };
  let res = await send(true);
  if (!res.ok && (res.status === 400 || res.status === 422 || res.status === 501)) {
    const said = await res.text();
    if (!/response_format|json_object|json mode|json_mode|structured/i.test(said)) throw httpError(config, res.status, said);
    res = await send(false);
  }
  if (!res.ok) throw httpError(config, res.status, await res.text());
  const body = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("The bot's design came back cut off. Try a shorter description, or a model with a longer output.");
  return choice?.message?.content ?? "";
}

function httpError(config: GeneratorConfig, status: number, body: string): Error {
  const p = preset(config.provider);
  if (status === 401 || status === 403) return new Error(`${p.label} didn't accept the API key${p.keyEnv ? ` (${p.keyEnv})` : ""}.`);
  if (status === 404) return new Error(`${p.label} doesn't know the model "${config.model}" (or the address is wrong). \`bot-forge models\` lists what it has.`);
  if (status === 429) return new Error(`${p.label} is rate limiting. Wait a moment and try again.`);
  return new Error(`${p.label} answered ${status}: ${body.slice(0, 300)}`);
}

async function viaOpenAI(description: string, config: GeneratorConfig, fetcher: typeof fetch): Promise<Draft> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${systemPrompt()}\n\nReply with one JSON object with these fields, and nothing else — no prose, no code fences:\n${JSON.stringify(DRAFT_SCHEMA)}` },
    { role: "user", content: `Design a bot for this:\n\n${description}` },
  ];
  const first = await complete(config, messages, fetcher);
  try {
    return parseDraft(first);
  } catch (error) {
    // Small models slip: show it what went wrong, once.
    const fixed = await complete(
      config,
      [
        ...messages,
        { role: "assistant", content: first },
        { role: "user", content: `That isn't a usable bot design (${(error as Error).message}). Reply again with only the JSON object, every field filled in.` },
      ],
      fetcher,
    );
    return parseDraft(fixed);
  }
}

/**
 * The model's JSON as a draft: fenced or not, with prose or a reasoning
 * model's `<think>` section around it.
 */
export function parseDraft(raw: string): Draft {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned)?.[1];
  const from = cleaned.indexOf("{");
  const to = cleaned.lastIndexOf("}");
  const candidates = [fenced, cleaned, from >= 0 && to > from ? cleaned.slice(from, to + 1) : undefined].filter((c): c is string => !!c);
  let value: unknown;
  for (const candidate of candidates) {
    try {
      value = JSON.parse(candidate);
      break;
    } catch {
      // try the next reading
    }
  }
  if (value === undefined) throw new Error("The model didn't send back a bot design (not JSON).");
  const parsed = Draft.safeParse(value);
  if (!parsed.success) throw new Error(`The model's bot design was incomplete: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`);
  return parsed.data;
}

/** The models a provider offers, for picking one. */
export async function listModels(config: GeneratorConfig, deps: Deps = {}): Promise<string[]> {
  if (config.kind === "anthropic") {
    const ids: string[] = [];
    try {
      for await (const model of anthropicClient(config, deps.anthropic).models.list()) ids.push(model.id);
    } catch (error) {
      throw new Error(describeClaudeError(error));
    }
    return ids;
  }
  if (!config.baseUrl) throw new Error("Give the server's address first.");
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${config.baseUrl}/models`, { headers: headersFor(config) });
  } catch (error) {
    throw unreachable(config, error);
  }
  if (!res.ok) throw httpError(config, res.status, await res.text());
  const body = (await res.json()) as { data?: { id?: unknown }[]; models?: { id?: unknown; name?: unknown }[] };
  const list = body.data ?? body.models ?? [];
  return [...new Set(list.flatMap((m) => [m.id, (m as { name?: unknown }).name].filter((x): x is string => typeof x === "string").slice(0, 1)))]
    .map((id) => id.replace(/^models\//, ""))
    .sort((a, b) => a.localeCompare(b));
}

export { PRESETS };
