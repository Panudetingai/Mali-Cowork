import type { CodexModel } from "@/features/codex";
import type { CursorModel } from "@/features/cursor";
import type { OpencodeModel, OpencodeModelsResult, WorkMode } from "@/features/opencode";
import type { AntigravityModel } from "@/features/antigravity";
import { cliModels, getCustomCli, normalizeCustomCliIcon, type CustomCli } from "@/features/custom-cli";
import { effortFor, storedEffortFor } from "@/features/effort";
import type { MediaKind } from "@/features/media";
import type { PuterModel } from "@/features/media/puter-catalog";
import { brandLogoForModelName } from "@/features/providers/model-logo";
import { providerContextLimit, type ProviderDef } from "@/features/providers";

/**
 * Where a model runs, so API models and CLI agents never share a heading:
 * `api` = the user's own API key, `local` = a server on this machine,
 * `opencode` = through OpenCode, `cli` = a signed-in CLI agent.
 */
export type ModelSource = "api" | "local" | "opencode" | "cli";

export type AiModel = {
  id: string;
  name: string;
  /** models.dev provider id, used for the logo. */
  provider: string;
  /** Custom CLI agent icon (data URL or HTTPS). */
  iconUrl?: string;
  source: ModelSource;
  group: string;
  /** Costs nothing per token (OpenCode models only). */
  free?: boolean;
  /** The provider has no API key yet; picking the model asks for one. */
  needsKey?: boolean;
  /** Cursor is installed but not signed in; picking the model asks to sign in. */
  needsLogin?: boolean;
  /** Context window in tokens, when known. */
  contextLimit?: number;
  /**
   * Why this model can't do the work in the mode the catalog was built for.
   * Set means "not offered here": the picker leaves it out and a stored
   * selection is replaced (see `substituteFor`).
   */
  issue?: string;
  /**
   * The model draws instead of answering, so the prompt goes straight to the
   * provider's picture or video API (see `features/media`) rather than to a
   * chat endpoint or an agent.
   */
  media?: MediaKind;
  /**
   * Reasoning effort levels this model accepts, weakest first. Empty or
   * absent means the model has no such setting and no control is shown.
   */
  efforts?: string[];
};

/**
 * Providers whose picture and video APIs Mali can call. Each one is a
 * provider Settings → Models already holds a key for, so making a picture
 * needs nothing set up beyond the key you chat with.
 *
 * Keep in step with `Provider::routes` in `src-tauri/src/media/providers.rs`,
 * which is what actually makes the call.
 */
const MEDIA_PROVIDERS = new Set(["google", "openai", "openrouter", "xai", "alibaba"]);

/** …and of those, the ones Mali knows how to ask for a video. */
const VIDEO_PROVIDERS = new Set(["google", "alibaba"]);

/** Why a model that draws can't run here, or undefined when it can. */
export function mediaIssue(providerId: string, media: MediaKind | undefined) {
  if (!media) return undefined;
  if (providerId === "puter") return undefined;
  if (media === "video" && !VIDEO_PROVIDERS.has(providerId)) {
    return "Mali can't ask this provider for video yet — Gemini, Qwen, or Puter can";
  }
  return undefined;
}

/**
 * Every picture or video model the configured providers sell, for the Visual
 * page. A key entered once to chat with is the same key that draws, so
 * nothing more is set up — and nobody has to know that
 * `gemini-3-pro-image-preview` exists to use it.
 *
 * Models the metadata does not cover are recognised by name, which is how a
 * `qwen-image-3.0` typed into Settings → Models is found.
 */
export function buildMediaCatalog(
  opencode: OpencodeModelsResult | null,
  providers: ConfiguredProvider[],
  kind: MediaKind,
  /** Puter's current list for `kind`; used once Puter has a token. */
  puter: PuterModel[] = [],
): AiModel[] {
  const fromKeys = providers.flatMap(({ provider, models }) => {
    if (!MEDIA_PROVIDERS.has(provider.id)) return [];
    const prefix = `${provider.id}/`;
    const fromCatalogue = (opencode?.models ?? [])
      .filter((m) => m.id.startsWith(prefix))
      .map((m) => m.id.slice(prefix.length));
    const seen = new Set<string>();
    return [...models, ...fromCatalogue].flatMap((name) => {
      if (seen.has(name)) return [];
      seen.add(name);
      const meta = opencode?.models.find((m) => m.id === `${prefix}${name}`);
      const media = mediaKindFor(meta, name);
      if (media !== kind || mediaIssue(provider.id, media)) return [];
      return [
        {
          id: apiModelId(provider.id, name),
          name,
          provider: provider.logo,
          source: "api" as const,
          group: provider.name,
          media,
        },
      ];
    });
  });
  // Puter's models come from Puter's own list, not from Settings → Models.
  const onPuter = providers.some(({ provider }) => provider.id === "puter");
  const seen = new Set(fromKeys.map((m) => m.id));
  const fromPuter: AiModel[] = (onPuter ? puter : [])
    .map((m) => ({
      id: apiModelId("puter", m.id),
      name: m.name,
      provider: brandLogoForModelName(m.id, "puter"),
      source: "api" as const,
      group: "Puter",
      media: kind,
      contextLimit: m.context,
    }))
    .filter((m) => !seen.has(m.id));
  return [...fromKeys, ...fromPuter];
}

/**
 * Model names that say outright what they make. Used only as a fallback, when
 * the metadata has nothing to say about a model — which is exactly the case
 * for one typed into Settings → Models by hand: `qwen-image-3.0` is not in
 * models.dev, so it arrived with no modalities, went down the chat path, and
 * came back as a validation error about `messages.0.role` that told the user
 * nothing. Any model the metadata *does* cover is decided by its real
 * modalities, so a naming coincidence cannot override the facts.
 */
const VIDEO_NAME = /(^|[-_/.])(video|veo|sora|t2v|wan[-_.]?\d)([-_./]|$)/i;
const IMAGE_NAME = /(^|[-_/.])(image|imagen|imagine|flux|dall[-_.]?e|t2i)([-_./0-9]|$)/i;

function mediaKindFromName(model: string): MediaKind | undefined {
  if (VIDEO_NAME.test(model)) return "video";
  if (IMAGE_NAME.test(model)) return "image";
  return undefined;
}

/**
 * What a model makes: its metadata when there is any, its name when there is
 * not. The name is never consulted for a model models.dev describes, so a
 * chat model that happens to have "image" in its name stays a chat model.
 */
function mediaKindFor(
  meta: Pick<OpencodeModel, "output"> | undefined,
  model: string,
): MediaKind | undefined {
  return (meta?.output?.length ?? 0) > 0 ? mediaKindOf(meta) : mediaKindFromName(model);
}

/**
 * What a model produces, when it is not words.
 *
 * models.dev carries this as `modalities.output`, and it is the only thing
 * that tells `gemini-3-pro-image-preview` apart from `gemini-3-pro`: both have
 * a context window, both are listed under Gemini, and only one of them will
 * ever answer a question.
 */
export function mediaKindOf(model: Pick<OpencodeModel, "output"> | undefined): MediaKind | undefined {
  const output = model?.output ?? [];
  if (output.includes("video") && !output.includes("text")) return "video";
  if (output.includes("image")) return "image";
  if (output.includes("video")) return "video";
  return undefined;
}

export type ConfiguredProvider = { provider: ProviderDef; models: string[] };

export const OPENCODE_PREFIX = "opencode:";
export const OPENCODE_DEFAULT_ID = `${OPENCODE_PREFIX}default`;
const API_PREFIX = "api:";
const CLI_PREFIX = "cli:";
export const CURSOR_PREFIX = "cursor:";
export const CURSOR_DEFAULT_ID = `${CURSOR_PREFIX}auto`;
export const CODEX_PREFIX = "codex:";
export const CODEX_DEFAULT_ID = `${CODEX_PREFIX}auto`;
export const ANTIGRAVITY_PREFIX = "antigravity:";
export const ANTIGRAVITY_DEFAULT_ID = `${ANTIGRAVITY_PREFIX}auto`;

export function isOpencodeModel(modelId: string) {
  return modelId.startsWith(OPENCODE_PREFIX);
}

export function isCursorModel(modelId: string) {
  return modelId.startsWith(CURSOR_PREFIX);
}

/** `cursor:<model>` → the model id the CLI expects. */
export function cursorModelOf(modelId: string) {
  return modelId.slice(CURSOR_PREFIX.length) || "auto";
}

export function isCodexModel(modelId: string) {
  return modelId.startsWith(CODEX_PREFIX);
}

/** `codex:<model>` → the model id the CLI expects. */
export function codexModelOf(modelId: string) {
  return modelId.slice(CODEX_PREFIX.length) || "auto";
}

export function isAntigravityModel(modelId: string) {
  return modelId.startsWith(ANTIGRAVITY_PREFIX);
}

/** `antigravity:<model>` → the model id the CLI expects. */
export function antigravityModelOf(modelId: string) {
  return modelId.slice(ANTIGRAVITY_PREFIX.length) || "auto";
}

export function isCliModel(modelId: string) {
  return modelId.startsWith(CLI_PREFIX);
}

/** A CLI the user added, with or without a model: `cli:<id>` or `cli:<id>/<model>`. */
export function customCliModelId(cliId: string, model?: string) {
  return `${CLI_PREFIX}${cliId}${model ? `/${model}` : ""}`;
}

/** `cli:<id>/<model>` → its parts; the model may itself contain slashes. */
export function customCliOf(modelId: string) {
  if (!isCliModel(modelId)) return undefined;
  const rest = modelId.slice(CLI_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return { id: rest, model: undefined };
  return { id: rest.slice(0, slash), model: rest.slice(slash + 1) || undefined };
}

function customCliMeta(modelId: string): Pick<AiModel, "name" | "provider" | "source" | "group" | "iconUrl"> {
  const parts = customCliOf(modelId);
  const cli = parts ? getCustomCli(parts.id) : undefined;
  const name = cli?.name ?? parts?.id ?? "CLI";
  const iconUrl = normalizeCustomCliIcon(cli?.icon);
  return {
    name: parts?.model ?? name,
    provider: "terminal",
    source: "cli",
    group: name,
    ...(iconUrl ? { iconUrl } : {}),
  };
}

/** `opencode:provider/model` → `provider/model`; undefined for the server default. */
export function opencodeModelOf(modelId: string) {
  const model = modelId.slice(OPENCODE_PREFIX.length);
  return model && model !== "default" ? model : undefined;
}

export function apiModelId(provider: string, model: string) {
  return `${API_PREFIX}${provider}/${model}`;
}

/** `api:provider/model` → its parts; the model itself may contain slashes. */
export function apiModelOf(modelId: string) {
  if (!modelId.startsWith(API_PREFIX)) return undefined;
  const rest = modelId.slice(API_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return undefined;
  return { provider: rest.slice(0, slash), model: rest.slice(slash + 1) };
}

/** Agent work needs tool calls and room for file contents and tool output. */
const MIN_COWORK_CONTEXT = 32_000;

/** Why a model is not fit for Cowork, or undefined when it is (or unknown). */
export function coworkIssueOf(model: Pick<OpencodeModel, "toolCall" | "contextLimit">) {
  if (model.toolCall === false) return "Can't call tools, so it can't work on files or use MCP";
  if (model.contextLimit && model.contextLimit < MIN_COWORK_CONTEXT) {
    return `Context window too small for agent work (${Math.round(model.contextLimit / 1000)}K)`;
  }
  return undefined;
}

/** The provider id OpenCode Zen's own models sit under. */
const ZEN_PROVIDER = "opencode";

const ZEN_FREE_ISSUE =
  "OpenCode Zen's free tier only answers full coding sessions — use it in Cowork";

/**
 * Why a model is not fit for Chat, or undefined when it is.
 *
 * Chat mode runs without the file tools, and OpenCode Zen turns its *free*
 * models down unless the request looks like a real OpenCode coding session:
 * every prompt came back as "OpenCode's free tier can only be used from within
 * OpenCode". Paid Zen models and every other provider are unaffected, so only
 * the free ones are held back — in Cowork, where the tools are there, they
 * work as before.
 */
export function chatIssueOf(model: Pick<AiModel, "provider" | "source" | "free">) {
  const zen = model.source === "opencode" && model.provider === ZEN_PROVIDER;
  return zen && model.free ? ZEN_FREE_ISSUE : undefined;
}

/**
 * What a stored model id produces, without building the whole catalog — the
 * send path carries an id, not a model.
 */
export function mediaKindForId(
  modelId: string,
  opencode: OpencodeModelsResult | null,
): MediaKind | undefined {
  const api = apiModelOf(modelId);
  if (!api || !MEDIA_PROVIDERS.has(api.provider)) return undefined;
  const meta = opencode?.models.find((m) => m.id === `${api.provider}/${api.model}`);
  return mediaKindFor(meta, api.model);
}

/** Whether a model id names a picture or video model, by id/name alone. */
export function isMediaModelId(modelId: string): boolean {
  const api = apiModelOf(modelId);
  if (api && MEDIA_PROVIDERS.has(api.provider)) return mediaKindFromName(api.model) !== undefined;
  if (isOpencodeModel(modelId)) {
    const ocId = opencodeModelOf(modelId);
    const name = ocId?.split("/")[1] ?? "";
    return mediaKindFromName(name) !== undefined;
  }
  return mediaKindFromName(modelId) !== undefined;
}

/**
 * Selectable models for a mode. Chat talks to provider APIs and OpenCode
 * (without file access); Cowork only offers agents that can work on folders.
 */
export function buildModelCatalog(
  opencode: OpencodeModelsResult | null,
  providers: ConfiguredProvider[],
  mode: WorkMode,
  cursor: { models: CursorModel[]; loggedIn: boolean } = { models: [], loggedIn: false },
  codex: { models: CodexModel[]; loggedIn: boolean } = { models: [], loggedIn: false },
  antigravity: { models: AntigravityModel[]; loggedIn: boolean } = { models: [], loggedIn: false },
  /** CLI agents the user added in Settings → Models. */
  customClis: CustomCli[] = [],
  /** When off, that agent is omitted from the picker (Settings → Models). */
  cliFilter: {
    opencode?: boolean;
    cursor?: boolean;
    codex?: boolean;
    antigravity?: boolean;
    customEnabled?: (id: string) => boolean;
  } = {},
): AiModel[] {
  const showOpencode = cliFilter.opencode !== false;
  const showCursor = cliFilter.cursor !== false;
  const showCodex = cliFilter.codex !== false;
  const showAntigravity = cliFilter.antigravity !== false;
  const customOk = cliFilter.customEnabled ?? (() => true);
  // models.dev metadata for every model, so a model the user typed into
  // Settings → Models is recognised as a picture model without a second call.
  const known = new Map((opencode?.models ?? []).map((m) => [m.id, m]));

  const apiModels: AiModel[] = providers.flatMap(({ provider, models }) =>
    models.map((model) => {
      const meta = known.get(`${provider.id}/${model}`);
      const media = MEDIA_PROVIDERS.has(provider.id) ? mediaKindFor(meta, model) : undefined;
      return {
        id: apiModelId(provider.id, model),
        name: model,
        provider: brandLogoForModelName(model, provider.logo),
        source: provider.group === "local" ? "local" : ("api" as const),
        group: provider.name,
        contextLimit: meta?.contextLimit ?? undefined,
        media,
        efforts: meta?.efforts,
        // Drawing models live on the Visual page; a chat request to one comes
        // back as a validation error about the message shape. In Cowork the
        // model drives Mali's own agent, so it has to call tools.
        issue: media
          ? `Makes ${media}s — use the Visual page`
          : mode === "cowork" && meta
            ? coworkIssueOf(meta)
            : undefined,
      };
    }),
  );


  // A provider configured in Settings → Models is synced into OpenCode, so the
  // same model was offered twice — once with the user's key, once "via
  // OpenCode" — with nothing to tell the two apart. The user's own key wins
  // and the OpenCode copy is dropped: in Chat it's a direct API call, in
  // Cowork it runs on Mali's own agent.
  const ownKeyModels = new Set(
    providers.flatMap(({ provider, models }) => models.map((m) => `${provider.id}/${m}`)),
  );

  const issueOf = (m: OpencodeModel) => {
    // OpenCode is a coding agent: handed a picture model it has nothing to
    // send and nothing to read back. Those live on the Visual page, where the
    // app calls the picture API directly.
    const media = mediaKindFor(m, m.id);
    if (media) return `Makes ${media}s — use the Visual page`;
    return mode === "cowork"
      ? coworkIssueOf(m)
      : chatIssueOf({ provider: m.providerId, source: "opencode", free: m.free });
  };

  const defaultModel = opencode?.models.find((m) => m.id === opencode.defaultModel);
  const opencodeModels: AiModel[] = showOpencode
    ? [
    {
      id: OPENCODE_DEFAULT_ID,
      name: defaultModel ? `Auto — OpenCode picks (${defaultModel.name})` : "Auto — OpenCode picks",
      provider: "opencode",
      source: "opencode",
      group: "OpenCode",
      free: defaultModel?.free,
      contextLimit: defaultModel?.contextLimit ?? undefined,
      efforts: defaultModel?.efforts,
      // "Auto" is only as usable as the model behind it.
      issue: defaultModel ? issueOf(defaultModel) : undefined,
    },
    ...(opencode?.models ?? []).filter((m) => !ownKeyModels.has(m.id)).map((m) => ({
      id: `${OPENCODE_PREFIX}${m.id}`,
      name: m.name,
      provider: m.providerId,
      source: "opencode" as const,
      // Bare provider name; the picker adds "via OpenCode" to the heading, so
      // repeating it on every row only adds noise.
      group: m.providerName,
      free: m.free,
      needsKey: !m.connected,
      contextLimit: m.contextLimit ?? undefined,
      efforts: m.efforts,
      issue: issueOf(m),
    })),
  ]
    : [];

  // Cursor runs on the user's own subscription, in both modes.
  const cursorModels: AiModel[] = !showCursor
    ? []
    : cursor.loggedIn
    ? cursor.models.map((m) => ({
        id: `${CURSOR_PREFIX}${m.id}`,
        name: m.name,
        provider: "cursor",
        source: "cli",
        group: "Cursor CLI",
      }))
    : [
        {
          id: CURSOR_DEFAULT_ID,
          name: "Cursor Agent (sign in)",
          provider: "cursor",
          source: "cli",
          group: "Cursor CLI",
          needsLogin: true,
        },
      ];

  // Codex runs on the user's own subscription, in both modes.
  const codexModels: AiModel[] = !showCodex
    ? []
    : codex.loggedIn && codex.models.length > 0
      ? codex.models.map((m) => ({
          id: `${CODEX_PREFIX}${m.id}`,
          name: m.name,
          provider: "codex",
          source: "cli",
          group: "Codex CLI",
          efforts: m.efforts,
        }))
      : [
          {
            id: CODEX_DEFAULT_ID,
            name: codex.loggedIn ? "Codex (auto)" : "Codex Agent (sign in)",
            provider: "codex",
            source: "cli",
            group: "Codex CLI",
            needsLogin: !codex.loggedIn,
          },
        ];

  // Antigravity CLI runs on the user's own Google account, in both modes.
  const antigravityModels: AiModel[] = !showAntigravity
    ? []
    : antigravity.loggedIn && antigravity.models.length > 0
      ? antigravity.models.map((m) => ({
          id: `${ANTIGRAVITY_PREFIX}${m.id}`,
          name: m.name,
          provider: "antigravity",
          source: "cli",
          group: "Antigravity CLI",
          efforts: m.efforts,
        }))
      : [
          {
            id: ANTIGRAVITY_DEFAULT_ID,
            name: antigravity.loggedIn ? "Antigravity (auto)" : "Antigravity CLI (sign in)",
            provider: "antigravity",
            source: "cli",
            group: "Antigravity CLI",
            needsLogin: !antigravity.loggedIn,
          },
        ];

  // A CLI the user added: its own default first (works once it's signed
  // in, no model to choose), then one entry per model it lists.
  const customCliModels: AiModel[] = customClis.flatMap((cli) => {
    if (!customOk(cli.id)) return [];
    const iconUrl = normalizeCustomCliIcon(cli.icon);
    const base = {
      provider: "terminal",
      source: "cli" as const,
      group: cli.name,
      ...(iconUrl ? { iconUrl } : {}),
    };
    const models = cliModels(cli);
    return [
      { ...base, id: customCliModelId(cli.id), name: models.length > 0 ? `Auto — ${cli.name} picks` : cli.name },
      ...models.map((model) => ({ ...base, id: customCliModelId(cli.id, model), name: model })),
    ];
  });

  return [...apiModels, ...cursorModels, ...codexModels, ...antigravityModels, ...customCliModels, ...opencodeModels];
}

/**
 * A stand-in for a model that can't do the work here: something from the same
 * place, and OpenCode's default at worst — never a different agent. Falling
 * through to whatever came first in the list quietly moved OpenCode chats onto
 * the Cursor CLI, which then ran (and billed) an account the user never picked.
 */
function substituteFor(catalog: AiModel[], model: AiModel): AiModel | undefined {
  const usable = catalog.filter(
    (m) => m.id !== model.id && !m.issue && !m.needsKey && !m.needsLogin,
  );
  return (
    usable.find((m) => m.source === model.source && m.provider === model.provider) ??
    usable.find((m) => m.source === model.source) ??
    usable.find((m) => m.id === OPENCODE_DEFAULT_ID)
  );
}

/** Resolve a stored id even before OpenCode models have loaded. */
export function findModel(catalog: AiModel[], id: string): AiModel {
  const found = catalog.find((m) => m.id === id);
  if (found && !found.issue) return found;
  // Picked in the other mode and not offered here: stay with its own kind.
  if (found) return substituteFor(catalog, found) ?? found;
  if (isCursorModel(id)) {
    const model = cursorModelOf(id);
    return { id, name: model === "auto" ? "Cursor Agent" : model, provider: "cursor", source: "cli", group: "Cursor CLI" };
  }
  if (isCodexModel(id)) {
    const model = codexModelOf(id);
    return { id, name: model === "auto" ? "Codex Agent" : model, provider: "codex", source: "cli", group: "Codex CLI" };
  }
  if (isAntigravityModel(id)) {
    const model = antigravityModelOf(id);
    return { id, name: model === "auto" ? "Antigravity CLI" : model, provider: "antigravity", source: "cli", group: "Antigravity CLI" };
  }
  if (isCliModel(id)) return { id, ...customCliMeta(id) };
  if (isOpencodeModel(id)) {
    const model = opencodeModelOf(id);
    return {
      id,
      name: model?.split("/")[1] ?? "OpenCode default",
      provider: model?.split("/")[0] ?? "opencode",
      source: "opencode",
      group: "OpenCode",
    };
  }
  return catalog[0];
}

/**
 * Which backend actually runs a model id. Each keeps its own session, so a
 * chat that changes agent starts over: worth saying out loud before it does.
 */
export function agentOf(modelId: string): "opencode" | "cursor" | "codex" | "antigravity" | "cli" | "api" {
  if (isOpencodeModel(modelId)) return "opencode";
  if (isCliModel(modelId)) return "cli";
  if (isCursorModel(modelId)) return "cursor";
  if (isCodexModel(modelId)) return "codex";
  if (isAntigravityModel(modelId)) return "antigravity";
  return "api";
}

const AGENT_NAMES: Record<ReturnType<typeof agentOf>, string> = {
  opencode: "OpenCode",
  cursor: "Cursor",
  codex: "Codex",
  antigravity: "Antigravity CLI",
  cli: "This CLI",
  api: "This model",
};

/** What to call the backend behind a model id, in a sentence. */
export function agentNameOf(modelId: string) {
  if (isCliModel(modelId)) return customCliMeta(modelId).group;
  return AGENT_NAMES[agentOf(modelId)];
}

/** Name, logo provider, and billing hint for a stored id without loading the full catalog. */
export function modelMetaFromId(
  modelId: string,
  opencode: OpencodeModelsResult | null,
): Pick<AiModel, "name" | "provider" | "source" | "free"> {
  const api = apiModelOf(modelId);
  if (api) {
    return {
      name: api.model,
      provider: brandLogoForModelName(api.model, api.provider),
      source: "api",
      free: false,
    };
  }
  if (isCursorModel(modelId)) {
    const model = cursorModelOf(modelId);
    return {
      name: model === "auto" ? "Cursor Agent" : model,
      provider: "cursor",
      source: "cli",
    };
  }
  if (isCodexModel(modelId)) {
    const model = codexModelOf(modelId);
    return {
      name: model === "auto" ? "Codex Agent" : model,
      provider: "codex",
      source: "cli",
    };
  }
  if (isAntigravityModel(modelId)) {
    const model = antigravityModelOf(modelId);
    return {
      name: model === "auto" ? "Antigravity CLI" : model,
      provider: "antigravity",
      source: "cli",
    };
  }
  if (isCliModel(modelId)) {
    const { name, provider, source, iconUrl } = customCliMeta(modelId);
    return { name, provider, source, ...(iconUrl ? { iconUrl } : {}) };
  }
  if (isOpencodeModel(modelId)) {
    if (modelId === OPENCODE_DEFAULT_ID) {
      const def = opencode?.models.find((m) => m.id === opencode.defaultModel);
      return {
        name: def?.name ?? "OpenCode default",
        provider: "opencode",
        source: "opencode",
        free: def?.free,
      };
    }
    const ocId = opencodeModelOf(modelId);
    const om = ocId ? opencode?.models.find((m) => m.id === ocId) : undefined;
    const parts = ocId?.split("/") ?? [];
    return {
      name: om?.name ?? parts[1] ?? "OpenCode",
      provider: om?.providerId ?? parts[0] ?? "opencode",
      source: "opencode",
      free: om?.free,
    };
  }
  return { name: modelId, provider: "opencode", source: "opencode" };
}

/** API and local models bill per token; OpenCode marks free tiers explicitly. */
export function modelIsPaid(meta: Pick<AiModel, "source" | "free">) {
  if (meta.source === "api" || meta.source === "local") return true;
  if (meta.source === "opencode") return meta.free !== true;
  return false;
}

/** The OpenCode provider behind a model id, if any. */
export function opencodeProviderOf(modelId: string) {
  return isOpencodeModel(modelId) ? opencodeModelOf(modelId)?.split("/")[0] : undefined;
}

export type ContextBudget = {
  /** Size of the context window used for the meter. */
  maxTokens: number;
  /** Continue in a new chat once the budget is used up. */
  autoNewChat: boolean;
};

const FALLBACK_CONTEXT = 128_000;

export function contextBudgetFor(model: AiModel): ContextBudget {
  const api = apiModelOf(model.id);
  const enforced = api ? providerContextLimit(api.provider) : undefined;
  if (enforced) return { maxTokens: enforced, autoNewChat: true };
  // Agents compact their own sessions, so they only get a meter.
  return { maxTokens: model.contextLimit ?? FALLBACK_CONTEXT, autoNewChat: false };
}

/** What a message stores so it can be sent again, for a model id alone. */
export type ResendSettings = {
  modelId: string;
  modelName: string;
  maxTokens: number;
  autoNewChat: boolean;
  /** How hard the model was asked to think; kept so a retry matches. */
  effort?: string;
};

/**
 * The resend settings of a model the user picked, without building the whole
 * catalog — so a retry can run on whatever model is selected now, which is how
 * a chat carries on when the one it started with runs out of credits.
 *
 * Returns undefined for a model that can't do the work this chat needs, so the
 * caller keeps the one the message was sent with.
 */
export function resendSettingsFor(
  modelId: string,
  opencode: OpencodeModelsResult | null,
  mode: WorkMode,
): ResendSettings | undefined {
  const meta = modelMetaFromId(modelId, opencode);
  const agentId =
    opencodeModelOf(modelId) ??
    (apiModelOf(modelId) ? `${apiModelOf(modelId)!.provider}/${apiModelOf(modelId)!.model}` : undefined);
  const known = agentId ? opencode?.models.find((m) => m.id === agentId) : undefined;
  const issue = !known
    ? undefined
    : mode === "cowork"
      ? coworkIssueOf(known)
      : isOpencodeModel(modelId)
        ? chatIssueOf({ provider: known.providerId, source: "opencode", free: known.free })
        : undefined;
  if (issue) return undefined;
  const budget = contextBudgetFor({
    id: modelId,
    name: meta.name,
    provider: meta.provider,
    source: meta.source,
    group: "",
    contextLimit: known?.contextLimit ?? undefined,
  });
  // A CLI agent's levels are not in the shared metadata, so for those the
  // last choice stands rather than silently dropping back to the default.
  const effort = known ? effortFor(modelId, known.efforts) : storedEffortFor(modelId);
  return { modelId, modelName: meta.name, ...budget, effort };
}

const DEFAULT_MODEL: Record<WorkMode, string> = {
  chat: OPENCODE_DEFAULT_ID,
  cowork: OPENCODE_DEFAULT_ID,
};

const selectedKey = (mode: WorkMode) => `chat_model_id:${mode}`;

export function loadSelectedModelId(mode: WorkMode) {
  try {
    return (
      localStorage.getItem(selectedKey(mode)) ??
      localStorage.getItem("chat_model_id") ??
      DEFAULT_MODEL[mode]
    );
  } catch {
    return DEFAULT_MODEL[mode];
  }
}

export function saveSelectedModelId(mode: WorkMode, id: string) {
  try {
    localStorage.setItem(selectedKey(mode), id);
  } catch {
    // Selection then lasts for this session only.
  }
}
