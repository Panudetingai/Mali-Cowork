import type { CodexModel } from "@/features/codex";
import type { CursorModel } from "@/features/cursor";
import type { OpencodeModel, OpencodeModelsResult, WorkMode } from "@/features/opencode";
import type { GeminiModel } from "@/features/gemini";
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
export const GEMINI_PREFIX = "gemini:";
export const GEMINI_DEFAULT_ID = `${GEMINI_PREFIX}auto`;

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

export function isGeminiModel(modelId: string) {
  return modelId.startsWith(GEMINI_PREFIX);
}

/** `gemini:<model>` → the model id the CLI expects. */
export function geminiModelOf(modelId: string) {
  return modelId.slice(GEMINI_PREFIX.length) || "auto";
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
  gemini: { models: GeminiModel[]; loggedIn: boolean } = { models: [], loggedIn: false },
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

  const defaultModel = opencode?.models.find((m) => m.id === opencode.defaultModel);
  const opencodeModels: AiModel[] = [
    {
      id: OPENCODE_DEFAULT_ID,
      name: defaultModel ? `OpenCode default (${defaultModel.name})` : "OpenCode default",
      provider: "opencode",
      source: "opencode",
      group: "OpenCode",
      free: defaultModel?.free,
      contextLimit: defaultModel?.contextLimit ?? undefined,
    },
    ...(opencode?.models ?? []).map((m) => ({
      id: `${OPENCODE_PREFIX}${m.id}`,
      name: m.name,
      provider: m.providerId,
      source: "opencode" as const,
      group: m.connected ? m.providerName : `${m.providerName} (needs key)`,
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

  // Gemini CLI runs on the user's own Google account, in both modes.
  const geminiModels: AiModel[] =
    gemini.loggedIn && gemini.models.length > 0
      ? gemini.models.map((m) => ({
          id: `${GEMINI_PREFIX}${m.id}`,
          name: m.name,
          provider: "gemini",
          source: "cli",
          group: "Gemini CLI",
        }))
      : [
          {
            id: GEMINI_DEFAULT_ID,
            name: gemini.loggedIn ? "Gemini (auto)" : "Gemini CLI (sign in)",
            provider: "gemini",
            source: "cli",
            group: "Gemini CLI",
            needsLogin: !gemini.loggedIn,
          },
        ];

  return mode === "cowork"
    ? [...cursorModels, ...codexModels, ...geminiModels, ...opencodeModels]
    : [...apiModels, ...cursorModels, ...codexModels, ...geminiModels, ...opencodeModels];
}

/** Resolve a stored id even before OpenCode models have loaded. */
export function findModel(catalog: AiModel[], id: string): AiModel {
  const found = catalog.find((m) => m.id === id);
  if (found && !found.coworkIssue) return found;
  // A model picked in Chat that can't do agent work: use the default instead.
  if (found) return catalog.find((m) => !m.coworkIssue) ?? found;
  if (isCursorModel(id)) {
    const model = cursorModelOf(id);
    return { id, name: model === "auto" ? "Cursor Agent" : model, provider: "cursor", source: "cli", group: "Cursor CLI" };
  }
  if (isCodexModel(id)) {
    const model = codexModelOf(id);
    return { id, name: model === "auto" ? "Codex Agent" : model, provider: "codex", source: "cli", group: "Codex CLI" };
  }
  if (isGeminiModel(id)) {
    const model = geminiModelOf(id);
    return { id, name: model === "auto" ? "Gemini CLI" : model, provider: "gemini", source: "cli", group: "Gemini CLI" };
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
