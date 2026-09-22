import type { CodexModel } from "@/features/codex";
import type { CursorModel } from "@/features/cursor";
import type { OpencodeModel, OpencodeModelsResult, WorkMode } from "@/features/opencode";
import type { AntigravityModel } from "@/features/antigravity";
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
  /** Why the model can't do Cowork's agent work; shown disabled when set. */
  coworkIssue?: string;
};

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
): AiModel[] {
  const knownLimits = new Map(
    (opencode?.models ?? []).map((m) => [m.id, m.contextLimit ?? undefined]),
  );

  const apiModels: AiModel[] = providers.flatMap(({ provider, models }) =>
    models.map((model) => ({
      id: apiModelId(provider.id, model),
      name: model,
      provider: provider.logo,
      source: provider.group === "local" ? "local" : "api",
      group: provider.name,
      contextLimit: knownLimits.get(`${provider.id}/${model}`),
    })),
  );

  // A provider configured in Settings → Models is synced into OpenCode, so the
  // same model was offered twice — once with the user's key, once "via
  // OpenCode" — with nothing to tell the two apart. In Chat, where both are
  // listed, the user's own key wins and the OpenCode copy is dropped. Cowork
  // lists no API models, so there the OpenCode copy is the only way in.
  const ownKeyModels =
    mode === "cowork"
      ? new Set<string>()
      : new Set(providers.flatMap(({ provider, models }) => models.map((m) => `${provider.id}/${m}`)));

  const defaultModel = opencode?.models.find((m) => m.id === opencode.defaultModel);
  const opencodeModels: AiModel[] = [
    {
      id: OPENCODE_DEFAULT_ID,
      name: defaultModel ? `Auto — OpenCode picks (${defaultModel.name})` : "Auto — OpenCode picks",
      provider: "opencode",
      source: "opencode",
      group: "OpenCode",
      free: defaultModel?.free,
      contextLimit: defaultModel?.contextLimit ?? undefined,
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
      coworkIssue: mode === "cowork" ? coworkIssueOf(m) : undefined,
    })),
  ];

  // Cursor runs on the user's own subscription, in both modes.
  const cursorModels: AiModel[] = cursor.loggedIn
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
  const codexModels: AiModel[] =
    codex.loggedIn && codex.models.length > 0
      ? codex.models.map((m) => ({
          id: `${CODEX_PREFIX}${m.id}`,
          name: m.name,
          provider: "codex",
          source: "cli",
          group: "Codex CLI",
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
  const antigravityModels: AiModel[] =
    antigravity.loggedIn && antigravity.models.length > 0
      ? antigravity.models.map((m) => ({
          id: `${ANTIGRAVITY_PREFIX}${m.id}`,
          name: m.name,
          provider: "antigravity",
          source: "cli",
          group: "Antigravity CLI",
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

  return mode === "cowork"
    ? [...cursorModels, ...codexModels, ...antigravityModels, ...opencodeModels]
    : [...apiModels, ...cursorModels, ...codexModels, ...antigravityModels, ...opencodeModels];
}

/**
 * A stand-in for a model that can't do the work here: something from the same
 * place, and OpenCode's default at worst — never a different agent. Falling
 * through to whatever came first in the list quietly moved OpenCode chats onto
 * the Cursor CLI, which then ran (and billed) an account the user never picked.
 */
function substituteFor(catalog: AiModel[], model: AiModel): AiModel | undefined {
  const usable = catalog.filter(
    (m) => m.id !== model.id && !m.coworkIssue && !m.needsKey && !m.needsLogin,
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
  if (found && !found.coworkIssue) return found;
  // A model picked in Chat that can't do agent work: stay with its own kind.
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
export function agentOf(modelId: string): "opencode" | "cursor" | "codex" | "antigravity" | "api" {
  if (isOpencodeModel(modelId)) return "opencode";
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
  api: "This model",
};

/** What to call the backend behind a model id, in a sentence. */
export function agentNameOf(modelId: string) {
  return AGENT_NAMES[agentOf(modelId)];
}

/** Name, logo provider, and billing hint for a stored id without loading the full catalog. */
export function modelMetaFromId(
  modelId: string,
  opencode: OpencodeModelsResult | null,
): Pick<AiModel, "name" | "provider" | "source" | "free"> {
  const api = apiModelOf(modelId);
  if (api) {
    return { name: api.model, provider: api.provider, source: "api", free: false };
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
  if (mode === "cowork" && known && coworkIssueOf(known)) return undefined;
  const budget = contextBudgetFor({
    id: modelId,
    name: meta.name,
    provider: meta.provider,
    source: meta.source,
    group: "",
    contextLimit: known?.contextLimit ?? undefined,
  });
  return { modelId, modelName: meta.name, ...budget };
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
