import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { createStore } from "@/lib/local-store";
import { getProvider, PROVIDERS, splitModels, type ProviderDef } from "./catalog";

export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  /** Comma-separated model ids. */
  models: string;
  /** Token budget per chat; empty uses the provider default. */
  contextLimit?: string;
};

const configStore = createStore<Record<string, ProviderConfig>>({}, { key: "mali_provider_configs" });
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
  return PROVIDERS.map((provider) => ({
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

export function ollamaListModels(baseUrl: string, apiKey?: string) {
  return invoke<string[]>("ollama_list_models", {
    baseUrl: baseUrl || null,
    apiKey: apiKey?.trim() || null,
  });
}

/**
 * Hand OpenRouter / Ollama / Ollama Cloud settings to OpenCode so Cowork can
 * use the same models as Chat. Restarts the agent server only when the
 * provider config actually changed.
 */
export async function syncCliProviders() {
  const configs = configStore.get();
  const providers = PROVIDERS.filter((p) => p.cli).map((provider) => {
    const config = configs[provider.id];
    return {
      id: provider.id,
      baseUrl: config?.baseUrl.trim() || provider.defaultBaseUrl,
      // Unconfigured providers send no models, which removes them.
      models: config ? splitModels(config.models) : [],
      apiKey: config?.apiKey.trim() || null,
    };
  });
  return invoke<{ restarted: boolean }>("opencode_configure_providers", { providers });
}
