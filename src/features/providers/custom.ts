/**
 * Providers the user adds in Settings → Models: any server that speaks the
 * OpenAI-compatible API, in the cloud (a new gateway, a reseller) or on this
 * machine (LM Studio, llama.cpp, vLLM, Jan…). They sit next to the built-in
 * ones everywhere — the model picker, Cowork, OpenCode and Voice — so a new
 * service works without waiting for a release.
 *
 * Ids are `custom-<slug>`; the backend knows them by that prefix
 * (`ai::is_custom_provider`) and always takes their address from the request.
 */
import { createStore } from "@/lib/local-store";
import type { ProviderDef } from "./catalog";

export type CustomProviderInput = {
  name: string;
  group: "local" | "cloud";
  baseUrl: string;
  /** Some servers (most local ones) take no key. */
  keyRequired: boolean;
  /** Where to get a key, if the service has such a page. */
  keyUrl?: string;
};

export type CustomProvider = CustomProviderInput & { id: string };

export const CUSTOM_PREFIX = "custom-";

/** Common OpenAI-compatible servers, to fill the form with one click. */
export const CUSTOM_PRESETS: (CustomProviderInput & { hint: string })[] = [
  { name: "LM Studio", group: "local", baseUrl: "http://localhost:1234/v1", keyRequired: false, hint: "Start the server in LM Studio's Developer tab." },
  { name: "llama.cpp", group: "local", baseUrl: "http://localhost:8080/v1", keyRequired: false, hint: "llama-server -m model.gguf" },
  { name: "vLLM", group: "local", baseUrl: "http://localhost:8000/v1", keyRequired: false, hint: "vllm serve <model>" },
  { name: "Jan", group: "local", baseUrl: "http://localhost:1337/v1", keyRequired: false, hint: "Turn on Jan's Local API Server." },
  { name: "LocalAI", group: "local", baseUrl: "http://localhost:8080/v1", keyRequired: false, hint: "local-ai run <model>" },
  { name: "Together AI", group: "cloud", baseUrl: "https://api.together.xyz/v1", keyRequired: true, keyUrl: "https://api.together.ai/settings/api-keys", hint: "Open models, pay as you go." },
  { name: "Fireworks", group: "cloud", baseUrl: "https://api.fireworks.ai/inference/v1", keyRequired: true, keyUrl: "https://fireworks.ai/account/api-keys", hint: "Fast open models." },
  { name: "Cerebras", group: "cloud", baseUrl: "https://api.cerebras.ai/v1", keyRequired: true, keyUrl: "https://cloud.cerebras.ai", hint: "Very fast inference, free tier." },
];

const store = createStore<CustomProvider[]>([], {
  key: "mali.custom-providers",
  revive: (list) => (Array.isArray(list) ? list.filter((p) => p?.id?.startsWith(CUSTOM_PREFIX) && p.baseUrl) : []),
});

export const useCustomProviders = store.use;
export const getCustomProviders = store.get;

export function isCustomProvider(id: string) {
  return id.startsWith(CUSTOM_PREFIX);
}

/** `My Server!` → `custom-my-server`, made unique among the ones there are. */
function newId(name: string, taken: Set<string>) {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "provider";
  let id = `${CUSTOM_PREFIX}${slug}`;
  for (let n = 2; taken.has(id); n++) id = `${CUSTOM_PREFIX}${slug}-${n}`;
  return id;
}

export function addCustomProvider(input: CustomProviderInput): CustomProvider {
  const taken = new Set(store.get().map((p) => p.id));
  const provider: CustomProvider = { ...input, name: input.name.trim(), baseUrl: input.baseUrl.trim(), id: newId(input.name, taken) };
  store.set((list) => [...list, provider]);
  return provider;
}

export function updateCustomProvider(id: string, patch: Partial<CustomProviderInput>) {
  store.set((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

export function removeCustomProvider(id: string) {
  store.set((list) => list.filter((p) => p.id !== id));
}

/** A user-added provider in the same shape as the built-in ones. */
export function customProviderDef(p: CustomProvider): ProviderDef {
  let host = p.baseUrl;
  try {
    host = new URL(p.baseUrl).host;
  } catch {
    // Shown as typed.
  }
  return {
    id: p.id,
    name: p.name,
    description: `Added by you · ${host}.`,
    logo: "custom",
    group: p.group,
    defaultBaseUrl: p.baseUrl,
    defaultModels: "",
    keyRequired: p.keyRequired,
    keyUrl: p.keyUrl,
    custom: true,
  };
}
