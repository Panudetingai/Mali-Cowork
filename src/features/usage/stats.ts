import type { UsageEvent } from "./ledger";

/** USD per million tokens (models.dev). */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead?: number | null;
  cacheWrite?: number | null;
};
export type Prices = Record<string, ModelPrice>;

export type ModelRef = {
  provider: string;
  model: string;
  /** Codex, Cursor and Antigravity bill a subscription, not per token. */
  subscription: boolean;
};

const SUBSCRIPTION_PREFIXES = ["codex:", "cursor:", "antigravity:"] as const;

/** Which provider and model an id names, whatever backend ran it. */
export function modelRefOf(modelId: string): ModelRef {
  for (const prefix of SUBSCRIPTION_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      const model = modelId.slice(prefix.length);
      const provider = prefix.slice(0, -1);
      return { provider, model: model === "auto" ? provider : model, subscription: true };
    }
  }
  const rest = modelId.replace(/^(api|opencode|cli):/, "");
  const slash = rest.indexOf("/");
  if (slash > 0 && slash < rest.length - 1) {
    return { provider: rest.slice(0, slash), model: rest.slice(slash + 1), subscription: false };
  }
  return { provider: rest === "default" ? "opencode" : "unknown", model: rest || "unknown", subscription: false };
}

function priceFor(ref: ModelRef, prices: Prices): ModelPrice | undefined {
  // OpenRouter ids carry the upstream vendor (`openrouter/anthropic/claude…`).
  return prices[`${ref.provider}/${ref.model}`] ?? prices[ref.model];
}

export type EventCost = { cost: number; estimated: boolean; known: boolean };

export type TokenSplit = { input: number; output: number; cache: number };

/**
 * A reply's tokens as three parts that add up to its total. Backends differ:
 * some count reasoning inside output, some apart; some count cache reads
 * inside input, others (OpenCode, Anthropic) only in the total. Whatever the
 * total holds beyond input and output is cache.
 */
export function splitTokens(event: UsageEvent): TokenSplit {
  const input = event.inputTokens;
  const withReasoning = event.outputTokens + event.reasoningTokens;
  const output = event.totalTokens >= input + withReasoning ? withReasoning : event.outputTokens;
  const cache = Math.max(0, event.totalTokens - input - output);
  return { input, output, cache };
}

/** The provider's reported cost, or one estimated from list prices. */
export function costOf(event: UsageEvent, prices: Prices): EventCost {
  if (event.cost != null) return { cost: event.cost, estimated: false, known: true };
  const ref = modelRefOf(event.modelId);
  if (ref.subscription) return { cost: 0, estimated: false, known: true };
  const price = priceFor(ref, prices);
  if (!price) return { cost: 0, estimated: false, known: false };
  const { input, output, cache } = splitTokens(event);
  const readPrice = price.cacheRead ?? price.input;
  const writePrice = price.cacheWrite ?? price.input;
  // Cache outside input: writes at their price, the rest as reads. Otherwise
  // cached reads sit inside input and are billed lower than the rest of it.
  const writes = Math.min(cache, event.cacheWriteTokens);
  const includedReads = cache > 0 ? 0 : Math.min(event.cacheReadTokens, input);
  const cost =
    ((input - includedReads) * price.input +
      includedReads * readPrice +
      writes * writePrice +
      (cache - writes) * readPrice +
      output * price.output) /
    1_000_000;
  return { cost, estimated: true, known: true };
}

export type UsageRange = { start: number; end: number };

export type DayUsage = TokenSplit & { day: number; cost: number; requests: number };

export type ModelRow = ModelRef &
  TokenSplit & {
    key: string;
    cost: number;
    estimated: boolean;
    tokens: number;
    requests: number;
  };

export type TopQuery = UsageEvent & { ref: ModelRef } & EventCost;

export type UsageSummary = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  cost: number;
  /** Part of `cost` estimated from list prices. */
  estimatedCost: number;
  /** Tokens on models with neither a reported cost nor a known price. */
  unpricedTokens: number;
  /** Median reply time, ms; undefined without timings. */
  p50LatencyMs?: number;
  p50FirstTokenMs?: number;
  daily: DayUsage[];
  byModel: ModelRow[];
  topQueries: TopQuery[];
};

export function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function median(values: number[]) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Local calendar days from `start` through `end`. */
export function daysIn({ start, end }: UsageRange) {
  const days: number[] = [];
  for (let day = startOfDay(start); day <= end; ) {
    days.push(day);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    day = next.getTime();
  }
  return days;
}

export function summarize(events: UsageEvent[], range: UsageRange, prices: Prices): UsageSummary {
  const inRange = events.filter((e) => e.createdAt >= range.start && e.createdAt <= range.end);
  const daily = new Map<number, DayUsage>(
    daysIn(range).map((day) => [day, { day, input: 0, output: 0, cache: 0, cost: 0, requests: 0 }]),
  );
  const models = new Map<string, ModelRow>();
  const summary: UsageSummary = {
    requests: inRange.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 0,
    cost: 0,
    estimatedCost: 0,
    unpricedTokens: 0,
    daily: [],
    byModel: [],
    topQueries: [],
  };
  const latencies: number[] = [];
  const firstTokens: number[] = [];
  const priced: TopQuery[] = [];

  for (const event of inRange) {
    const ref = modelRefOf(event.modelId);
    const price = costOf(event, prices);
    const split = splitTokens(event);
    const tokens = split.input + split.output + split.cache;
    summary.inputTokens += split.input;
    summary.outputTokens += split.output;
    summary.cacheTokens += split.cache;
    summary.totalTokens += tokens;
    summary.cost += price.cost;
    if (price.estimated) summary.estimatedCost += price.cost;
    if (!price.known) summary.unpricedTokens += event.totalTokens;
    if (event.durationMs) latencies.push(event.durationMs);
    if (event.firstTokenMs) firstTokens.push(event.firstTokenMs);

    const day = daily.get(startOfDay(event.createdAt));
    if (day) {
      day.input += split.input;
      day.output += split.output;
      day.cache += split.cache;
      day.cost += price.cost;
      day.requests += 1;
    }

    const key = `${ref.provider}/${ref.model}`;
    let row = models.get(key);
    if (!row) {
      row = { ...ref, key, cost: 0, estimated: false, tokens: 0, requests: 0, input: 0, output: 0, cache: 0 };
      models.set(key, row);
    }
    row.cost += price.cost;
    row.estimated ||= price.estimated;
    row.tokens += tokens;
    row.input += split.input;
    row.output += split.output;
    row.cache += split.cache;
    row.requests += 1;

    priced.push({ ...event, ref, ...price });
  }

  summary.p50LatencyMs = median(latencies);
  summary.p50FirstTokenMs = median(firstTokens);
  summary.daily = [...daily.values()];
  summary.byModel = [...models.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  summary.topQueries = priced
    .sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens)
    .slice(0, 8);
  return summary;
}

/** The same length of time just before `range`. */
export function previousRange({ start, end }: UsageRange): UsageRange {
  return { start: start - (end - start) - 1, end: start - 1 };
}

/** Signed change in percent, or undefined when there is nothing to compare with. */
export function change(current: number, previous: number) {
  if (!previous || !Number.isFinite(previous)) return undefined;
  return ((current - previous) / previous) * 100;
}
