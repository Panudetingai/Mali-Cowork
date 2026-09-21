import { getSecret, setSecret, useVaultStatus } from "@/features/secrets";
import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";

/**
 * Smithery (smithery.ai) as an extra place to search for MCP servers and
 * skills, switched on by the user's own API key.
 *
 * It is never required: the official MCP Registry and GitHub stay in place,
 * and everything found here is installed through the same dialogs, with the
 * same checks, as anything else.
 *
 * The key lives in the OS keychain with the app's other secrets, not in the
 * settings file.
 */

/** The keychain entry holding the API key. */
export const SMITHERY_SECRET = "smithery:api_key";

export type SmitheryAccount = {
  /** Namespaces the key can publish under; empty is normal. */
  namespaces: string[];
};

export type SmitheryState = {
  /** Whether searches should include Smithery. */
  enabled: boolean;
  /** What the last successful check said the key belongs to. */
  account?: SmitheryAccount;
  /** When the key was last accepted, as an ISO date. */
  checkedAt?: string;
};

const store = createStore<SmitheryState>(
  { enabled: false },
  {
    key: "mali_smithery",
    revive: (value) => ({
      enabled: value?.enabled === true,
      account: value?.account,
      checkedAt: typeof value?.checkedAt === "string" ? value.checkedAt : undefined,
    }),
  },
);

export const useSmithery = store.use;
export const getSmithery = store.get;
export const subscribeToSmithery = store.subscribe;

/** The key, if one was saved. */
export function smitheryKey(): string | undefined {
  return getSecret(SMITHERY_SECRET)?.trim() || undefined;
}

/** Whether Smithery should be searched: switched on, and holding a key. */
export function smitheryReady(state: SmitheryState = store.get()): boolean {
  return state.enabled && !!smitheryKey();
}

/**
 * The same question from React.
 *
 * The key lives in the keychain, which is read after the app starts — so
 * this watches the vault too. Without that, Smithery looks disconnected for
 * the first moment of every launch and nothing re-checks once it isn't.
 */
export function useSmitheryReady(): boolean {
  const state = useSmithery();
  const vault = useVaultStatus();
  return vault.state !== "loading" && smitheryReady(state);
}

/** Whether a key is saved at all, however the switch is set. */
export function useSmitheryConnected(): boolean {
  useSmithery();
  const vault = useVaultStatus();
  return vault.state !== "loading" && !!smitheryKey();
}

/**
 * Check a key with Smithery and, if it holds up, save it and switch searching
 * on. The check asks Smithery about the account rather than running a search,
 * because a search answers the same whether the key is real or not.
 */
export async function connectSmithery(key: string): Promise<SmitheryAccount> {
  const account = await invoke<SmitheryAccount>("smithery_check_key", { key: key.trim() });
  setSecret(SMITHERY_SECRET, key.trim());
  store.set({ enabled: true, account, checkedAt: new Date().toISOString() });
  return account;
}

/** Forget the key and stop searching Smithery. */
export function disconnectSmithery() {
  setSecret(SMITHERY_SECRET, undefined);
  store.set({ enabled: false });
}

/** Keep the key, but leave Smithery out of searches for now. */
export function setSmitheryEnabled(enabled: boolean) {
  store.set((s) => ({ ...s, enabled }));
}
