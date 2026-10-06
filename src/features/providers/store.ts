import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { bindSecrets, stripSecrets, whenVaultReady } from "@/features/secrets";
import { createStore } from "@/lib/local-store";
import { allProviders, getProvider, splitModels, type ProviderDef } from "./catalog";

export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  /** Comma-separated model ids. */
  models: string;
  /** Token budget per chat; empty uses the provider default. */
  contextLimit?: string;
};

type Configs = Record<string, ProviderConfig>;

// API keys live in the OS keychain; localStorage keeps the rest.
const apiKeys = {
  read: (configs: Configs) =>
    Object.fromEntries(Object.entries(configs).map(([id, c]) => [id, c.apiKey?.trim() ?? ""])),
  write: (configs: Configs, keys: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(configs).map(([id, c]) => [id, id in keys ? { ...c, apiKey: keys[id] } : c]),
    ),
};

const configStore = createStore<Configs>({}, {
  key: "mali_provider_configs",
  persist: (configs) => stripSecrets(configs, apiKeys),
});
bindSecrets(configStore, { prefix: "provider:", ...apiKeys });
// Providers whose key is set in `.env`; fetched once from the backend.
const envStore = createStore<string[]>([]);
let envRequested = false;

export const useProviderConfigs = configStore.use;

export function useEnvKeys() {
  useEffect(() => {
    if (envRequested) return;
    envRequested = true;
    invoke<string[]>("provider_env_keys")
      .then(envStore.set)
      .catch(() => {
        envRequested = false;
      });
  }, []);
  return envStore.use();
}

export function getProviderConfig(id: string): ProviderConfig | undefined {
  return configStore.get()[id];
}

export function saveProviderConfig(id: string, config: ProviderConfig) {
  configStore.set((prev) => ({ ...prev, [id]: config }));
}

export function removeProviderConfig(id: string) {
  configStore.set(({ [id]: _removed, ...rest }) => rest);
}

/** The form values for a provider: its saved config, or sensible defaults. */
export function configOrDefaults(provider: ProviderDef, saved?: ProviderConfig): ProviderConfig {
  return saved ?? {
    apiKey: "",
    baseUrl: provider.defaultBaseUrl,
    models: provider.defaultModels,
    contextLimit: provider.contextLimit ? String(provider.contextLimit) : "",
  };
}

/** The enforced token budget for a provider, if any. */
export function providerContextLimit(providerId: string): number | undefined {
  const saved = Number(getProviderConfig(providerId)?.contextLimit?.replace(/[,_\s]/g, ""));
  if (Number.isFinite(saved) && saved > 0) return saved;
  return getProvider(providerId)?.contextLimit;
}

export function hasKey(provider: ProviderDef, config: ProviderConfig | undefined, envKeys: string[]) {
  return !provider.keyRequired || !!config?.apiKey.trim() || envKeys.includes(provider.id);
}

/** Models a provider can serve right now; empty when it isn't usable. */
export function usableModels(
  provider: ProviderDef,
  config: ProviderConfig | undefined,
  envKeys: string[],
) {
  // Env-only providers work with their default models until configured in the UI.
  if (!config && !envKeys.includes(provider.id)) return [];
  if (!hasKey(provider, config, envKeys)) return [];
  return splitModels(configOrDefaults(provider, config).models);
}

export function listConfiguredProviders(configs: Record<string, ProviderConfig>, envKeys: string[]) {
  return allProviders().map((provider) => ({
    provider,
    models: usableModels(provider, configs[provider.id], envKeys),
  })).filter((entry) => entry.models.length > 0);
}

/** Settings sent with a chat request; the backend falls back to `.env`. */
export function requestConfigFor(providerId: string) {
  const provider = getProvider(providerId);
  const config = getProviderConfig(providerId);
  return {
    apiKey: config?.apiKey.trim() || null,
    baseUrl: config?.baseUrl.trim() || provider?.defaultBaseUrl || null,
  };
}

/**
 * What the user actually pasted: keys are often copied with quotes, a
 * `NAME=` prefix from a `.env` line, or a stray newline from the provider's
 * page. None of those belong in the key, and a key sent with them is
 * rejected with an error that names none of this.
 */
export function cleanApiKey(value: string): string {
  return value
    .trim()
    .replace(/^[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\s*[=:]\s*/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** A pasted link to the provider's key page, rather than a key. */
export function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(value.trim());
}

export type KeyCheck = {
  /** `valid`, `rejected`, or `unknown` when the provider could not answer. */
  status: "valid" | "rejected" | "unknown";
  /** What the provider replied, when it rejected the key. */
  message?: string | null;
};

/**
 * Ask the provider whether a key works before it is saved. Anything other
 * than a clear rejection answers `unknown`, so an offline machine or a
 * provider without a model list never blocks saving.
 */
export async function checkProviderKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<KeyCheck> {
  try {
    return await invoke<KeyCheck>("provider_check_key", {
      provider: providerId,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl?.trim() || null,
    });
  } catch {
    return { status: "unknown" };
  }
}

/** How a model answered a test message (see `provider_test_model`). */
export type ModelTest = { ok: boolean; message: string; durationMs: number };

/** Send one short message to a model with these settings, to see that they work. */
export function testProviderModel(providerId: string, model: string, apiKey: string, baseUrl?: string) {
  return invoke<ModelTest>("provider_test_model", {
    provider: providerId,
    model,
    apiKey: cleanApiKey(apiKey) || null,
    baseUrl: baseUrl?.trim() || null,
  });
}

/** The chat models the provider's own API lists for this key, newest first. */
export function listProviderModels(providerId: string, apiKey: string, baseUrl?: string) {
  return invoke<string[]>("provider_list_models", {
    provider: providerId,
    apiKey: cleanApiKey(apiKey) || null,
    baseUrl: baseUrl?.trim() || null,
  });
}

export function ollamaListModels(baseUrl: string, apiKey?: string) {
  return invoke<string[]>("ollama_list_models", {
    baseUrl: baseUrl || null,
    apiKey: apiKey?.trim() || null,
  });
}

/**
 * Hand every provider's settings to OpenCode so Cowork, and Chat with MCP
 * servers on, can use the same models and keys. Restarts the agent server
 * only when the provider config actually changed.
 */
export async function syncCliProviders() {
  // Keys come from the keychain; syncing before they load would drop them.
  await whenVaultReady();
  const configs = configStore.get();
  const providers = allProviders().filter((provider) => !provider.maliOnly).map((provider) => {
    const config = configs[provider.id];
    return {
      id: provider.id,
      name: provider.custom ? provider.name : null,
      baseUrl: config?.baseUrl.trim() || provider.defaultBaseUrl,
      // Unconfigured providers send no models, which removes them.
      models: config ? splitModels(config.models) : [],
      apiKey: config?.apiKey.trim() || null,
    };
  });
  return invoke<{ restarted: boolean }>("opencode_configure_providers", { providers });
}
