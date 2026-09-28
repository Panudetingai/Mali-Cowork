import { describe, expect, test } from "bun:test";
import type { UsageEvent } from "./ledger";
import { costOf, modelRefOf, previousRange, summarize } from "./stats";

const event = (over: Partial<UsageEvent>): UsageEvent => ({
  id: crypto.randomUUID(),
  createdAt: new Date(2026, 8, 20, 12).getTime(),
  modelId: "api:openai/gpt-5",
  title: "hi",
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  ...over,
});

const prices = { "openai/gpt-5": { input: 1, output: 10, cacheRead: 0.1 } };

describe("modelRefOf", () => {
  test("reads every backend's id", () => {
    expect(modelRefOf("api:openai/gpt-5")).toEqual({ provider: "openai", model: "gpt-5", subscription: false });
    expect(modelRefOf("opencode:openrouter/anthropic/claude")).toMatchObject({
      provider: "openrouter",
      model: "anthropic/claude",
    });
    expect(modelRefOf("codex:auto")).toEqual({ provider: "codex", model: "codex", subscription: true });
    expect(modelRefOf("openai/gpt-5").provider).toBe("openai");
  });
});

describe("costOf", () => {
  test("a reported cost wins, even zero", () => {
    expect(costOf(event({ cost: 0, inputTokens: 1_000_000 }), prices)).toEqual({ cost: 0, estimated: false, known: true });
  });
  test("cache outside input is priced as cache, not output", () => {
    // OpenCode-style: 900K cache reads only in the total.
    const e = event({ inputTokens: 100_000, outputTokens: 10_000, totalTokens: 1_010_000 });
    expect(costOf(e, prices).cost).toBeCloseTo(0.1 + 0.1 + 0.09, 6);
  });
  test("estimates from list prices, cached input at its own price", () => {
    const e = event({ inputTokens: 1_000_000, cacheReadTokens: 500_000, outputTokens: 100_000, totalTokens: 1_100_000 });
    const { cost, estimated } = costOf(e, prices);
    expect(estimated).toBe(true);
    expect(cost).toBeCloseTo(0.5 + 0.05 + 1, 6);
  });
  test("subscriptions cost nothing; unknown models are flagged", () => {
    expect(costOf(event({ modelId: "cursor:auto", totalTokens: 5 }), prices).cost).toBe(0);
    expect(costOf(event({ modelId: "api:x/y", totalTokens: 5 }), prices).known).toBe(false);
  });
});

describe("summarize", () => {
  test("totals, daily buckets and top replies stay within the range", () => {
    const start = new Date(2026, 8, 19).getTime();
    const end = new Date(2026, 8, 21, 23, 59).getTime();
    const events = [
      event({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cost: 0.5, durationMs: 1000 }),
      event({ inputTokens: 10, outputTokens: 5, reasoningTokens: 15, totalTokens: 30, cost: 0.1, durationMs: 3000 }),
      event({ inputTokens: 10, outputTokens: 5, totalTokens: 100, cost: 0 }),
      event({ createdAt: start - 1, totalTokens: 999, cost: 9 }),
    ];
    const s = summarize(events, { start, end }, prices);
    expect(s.requests).toBe(3);
    // Reasoning counted apart from output lands in "output"…
    expect(s.outputTokens).toBe(45);
    // …and what the total holds beyond input and output is cache.
    expect(s.cacheTokens).toBe(85);
    expect(s.totalTokens).toBe(250);
    expect(s.cost).toBeCloseTo(0.6);
    expect(s.p50LatencyMs).toBe(2000);
    expect(s.daily).toHaveLength(3);
    expect(s.daily[1].requests).toBe(3);
    expect(s.topQueries[0].cost).toBe(0.5);
  });
  test("previousRange is the same length, just before", () => {
    const prev = previousRange({ start: 1000, end: 2000 });
    expect(prev).toEqual({ start: -1, end: 999 });
  });
});
