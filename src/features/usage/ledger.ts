/**
 * The usage ledger: every model reply's tokens and cost, saved in SQLite
 * apart from the chats (see `storage/usage.rs`), so deleting a chat never
 * lowers what the Usage page and the sidebar say was spent.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createStore } from "@/lib/local-store";
import type { AgentUsage } from "@/pages/chat/types";

export type UsageEvent = {
  id: string;
  /** Unix ms. */
  createdAt: number;
  /** The id the reply was requested with, e.g. `api:openai/gpt-5`. */
  modelId: string;
  chatId?: string | null;
  /** Start of the prompt. */
  title: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** USD as the provider reported it; null when it didn't. */
  cost?: number | null;
  durationMs?: number | null;
  firstTokenMs?: number | null;
};

type LedgerState = { events: UsageEvent[]; loaded: boolean; error?: string };

const store = createStore<LedgerState>({ events: [], loaded: false });
let loading: Promise<void> | undefined;

export const useUsageLedger = store.use;

/** Load the whole ledger once; later replies are appended as they finish. */
export function loadUsageLedger(force = false) {
  if (!isTauri()) {
    store.set({ events: [], loaded: true });
    return Promise.resolve();
  }
  if (loading && !force) return loading;
  loading = invoke<UsageEvent[]>("usage_load", { since: null })
    .then((events) => {
      // Replies recorded while the load was in flight are kept.
      const loadedIds = new Set(events.map((e) => e.id));
      const pending = store.get().events.filter((e) => !loadedIds.has(e.id));
      store.set({ events: [...events, ...pending], loaded: true });
    })
    .catch((error) => {
      loading = undefined;
      store.set((prev) => ({ ...prev, loaded: true, error: String(error) }));
    });
  return loading;
}

/** Sum as the reply reports it; some backends only send the parts. */
function totalOf(usage: AgentUsage) {
  const parts = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
  return usage.totalTokens && usage.totalTokens > 0 ? usage.totalTokens : parts;
}

export type ReplyUsage = {
  modelId: string;
  chatId?: string;
  prompt: string;
  usage: AgentUsage;
  durationMs?: number;
  firstTokenMs?: number;
};

/** Record one finished reply. Never throws: usage must not break a chat. */
export function recordUsage({ modelId, chatId, prompt, usage, durationMs, firstTokenMs }: ReplyUsage) {
  const totalTokens = totalOf(usage);
  if (totalTokens <= 0 && !(usage.cost && usage.cost > 0)) return;
  const event: UsageEvent = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    modelId,
    chatId: chatId ?? null,
    title: prompt.trim().split("\n")[0].slice(0, 200),
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    totalTokens,
    cost: usage.cost ?? null,
    durationMs: durationMs != null ? Math.round(durationMs) : null,
    firstTokenMs: firstTokenMs != null ? Math.round(firstTokenMs) : null,
  };
  store.set((prev) => ({ ...prev, events: [...prev.events, event] }));
  if (isTauri()) {
    invoke("usage_record", { event }).catch((error) => console.warn("[usage] not recorded", error));
  }
}
