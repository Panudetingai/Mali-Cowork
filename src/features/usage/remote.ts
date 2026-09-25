/** What providers report about the account itself (see `usage_remote.rs`). */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getSecret, setSecret } from "@/features/secrets";
import { requestConfigFor } from "@/features/providers";
import type { Prices } from "./stats";

export type DailyUsage = {
  day: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
};

export type ProviderAccount = {
  provider: string;
  kind: "credits" | "balance" | "organization";
  currency: string;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  periodCost?: number | null;
  periodInputTokens?: number | null;
  periodOutputTokens?: number | null;
  periodRequests?: number | null;
  daily: DailyUsage[];
  detail?: string | null;
};

/** Providers with an account API, and what it needs. */
export const ACCOUNT_PROVIDERS = [
  { id: "openai", admin: true, keyUrl: "https://platform.openai.com/settings/organization/admin-keys" },
  { id: "anthropic", admin: true, keyUrl: "https://console.anthropic.com/settings/admin-keys" },
  { id: "openrouter", admin: false },
  { id: "deepseek", admin: false },
  { id: "moonshotai", admin: false },
] as const;

export type AccountProviderId = (typeof ACCOUNT_PROVIDERS)[number]["id"];

// Admin keys read the whole organisation's bill, so they stay in the keychain.
const adminSecret = (provider: string) => `usage-admin:${provider}`;

export function getAdminKey(provider: string) {
  return getSecret(adminSecret(provider));
}

export function setAdminKey(provider: string, key: string | undefined) {
  setSecret(adminSecret(provider), key?.trim() || undefined);
}

export function fetchProviderAccount(provider: string, days: number) {
  const { apiKey, baseUrl } = requestConfigFor(provider);
  return invoke<ProviderAccount>("usage_provider_account", {
    provider,
    apiKey,
    baseUrl,
    adminKey: getAdminKey(provider) ?? null,
    days,
  });
}

let prices: Promise<Prices> | undefined;

/** List prices from models.dev, cached a day by the backend; empty offline. */
export function loadModelPrices(): Promise<Prices> {
  if (!isTauri()) return Promise.resolve({});
  prices ??= invoke<Prices>("usage_model_prices").catch(() => {
    prices = undefined;
    return {};
  });
  return prices;
}
