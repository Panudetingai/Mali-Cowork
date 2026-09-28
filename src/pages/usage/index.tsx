"use client";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useChatSessions } from "@/features/chat-history";
import { getProvider, ProviderLogo, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { useVaultStatus } from "@/features/secrets";
import {
  ACCOUNT_PROVIDERS,
  change,
  fetchProviderAccount,
  getAdminKey,
  loadModelPrices,
  loadUsageLedger,
  previousRange,
  setAdminKey,
  startOfDay,
  summarize,
  useUsageLedger,
  type DayUsage,
  type ModelRow,
  type Prices,
  type ProviderAccount,
  type TokenSplit,
  type TopQuery,
  type UsageRange,
} from "@/features/usage";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SecretInput } from "@/pages/settings/ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { animate, AnimatePresence, motion, MotionConfig, useAnimate } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const RANGES = [
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "month", label: "This month", days: 0 },
  { id: "90d", label: "90D", days: 90 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en-US");
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function money(value: number, currency = "USD") {
  const small = Math.abs(value) > 0 && Math.abs(value) < 1;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: small ? 4 : 2,
  }).format(value);
}

function duration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function ago(time: number) {
  const seconds = (time - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function rangeFor(id: RangeId): UsageRange {
  const end = Date.now();
  if (id === "month") {
    const start = new Date();
    start.setDate(1);
    return { start: startOfDay(start.getTime()), end };
  }
  const days = RANGES.find((r) => r.id === id)?.days ?? 30;
  return { start: startOfDay(end - (days - 1) * 86_400_000), end };
}

function rangeLabel(id: RangeId) {
  if (id === "month") return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `Last ${RANGES.find((r) => r.id === id)?.days} days`;
}

function providerName(id: string) {
  const known: Record<string, string> = { codex: "Codex", cursor: "Cursor", antigravity: "Antigravity", opencode: "OpenCode" };
  return getProvider(id)?.name ?? known[id] ?? id;
}

export default function UsagePage() {
  const { events, loaded, error } = useUsageLedger();
  const [rangeId, setRangeId] = useState<RangeId>("30d");
  const [prices, setPrices] = useState<Prices>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadModelPrices().then(setPrices);
  }, []);

  // Force a reload: the Quick bar records into the same ledger from its own window.
  useEffect(() => {
    setRefreshing(true);
    void loadUsageLedger(true).finally(() => setRefreshing(false));
  }, [refreshKey]);

  const range = useMemo(() => rangeFor(rangeId), [rangeId, events]);
  const summary = useMemo(() => summarize(events, range, prices), [events, range, prices]);
  const previous = useMemo(() => summarize(events, previousRange(range), prices), [events, range, prices]);
  const days = Math.round((range.end - range.start) / 86_400_000) || 1;

  return (
    <MotionConfig reducedMotion="user">
      {/* The app layout scrolls this page, so the cards keep their natural height. */}
      <div>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 lg:py-10">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={rangeId}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground"
                >
                  {rangeLabel(rangeId)}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={rangeId}
                onValueChange={(value) => value && setRangeId(value as RangeId)}
                aria-label="Time range"
              >
                {RANGES.map((r) => (
                  <ToggleGroupItem key={r.id} value={r.id} className="px-3 text-xs">
                    {r.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={refreshing}
              >
                <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </header>

          {error && <p className="text-sm text-destructive">Couldn’t read the usage history: {error}</p>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              pulse={rangeId}
              index={0}
              label="Requests"
              value={summary.requests}
              format={(n) => exact.format(Math.round(n))}
              delta={change(summary.requests, previous.requests)}
              note="vs previous period"
            />
            <Stat
              pulse={rangeId}
              index={1}
              label="Tokens used"
              value={summary.totalTokens}
              format={(n) => compact.format(n)}
              delta={change(summary.totalTokens, previous.totalTokens)}
              note={`${compact.format(summary.inputTokens)} in · ${compact.format(summary.outputTokens)} out · ${compact.format(summary.cacheTokens)} cache`}
            />
            <Stat
              pulse={rangeId}
              index={2}
              label="Total cost"
              value={summary.cost}
              format={(n) => money(n)}
              delta={change(summary.cost, previous.cost)}
              upIsGood={false}
              note={summary.estimatedCost > 0 ? `~${money(summary.estimatedCost)} estimated` : "as reported"}
            />
            <Stat
              pulse={rangeId}
              index={3}
              label="Reply time"
              value={summary.p50LatencyMs}
              format={duration}
              delta={
                summary.p50LatencyMs != null && previous.p50LatencyMs != null
                  ? change(summary.p50LatencyMs, previous.p50LatencyMs)
                  : undefined
              }
              upIsGood={false}
              note={
                summary.p50FirstTokenMs != null
                  ? `p50 · first token ${duration(summary.p50FirstTokenMs)}`
                  : "p50 full reply"
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card index={4} pulse={rangeId} title="Daily token usage" aside={<Legend />}>
              {loaded ? <DailyChart daily={summary.daily} /> : <Loading />}
            </Card>
            <Card index={5} pulse={rangeId} title="Model token usage">
              <ModelTokens rows={summary.byModel} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card index={6} pulse={rangeId} title="Cost by model">
              <CostByModel rows={summary.byModel} />
            </Card>
            <Card index={7} pulse={rangeId} title="Most expensive replies">
              <TopQueries rows={summary.topQueries} />
            </Card>
          </div>

          <Card index={8} pulse={rangeId} title="Provider accounts">
            <ProviderAccounts days={Math.min(90, Math.max(1, days))} refreshKey={refreshKey} />
          </Card>

          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Every reply is kept in a usage history of its own, so deleting a chat doesn’t lower these figures. Cost is
            what the provider reported with the reply; where it didn’t, it is estimated from models.dev list prices
            (marked ~). Codex, Cursor and Antigravity run on subscriptions and count as $0.
            {summary.unpricedTokens > 0 &&
              ` ${compact.format(summary.unpricedTokens)} tokens are on models with no known price and aren’t in the cost.`}
          </p>
        </div>
      </div>
    </MotionConfig>
  );
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Cards rise in one after another, once, when the page opens. */
function rise(index: number) {
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay: index * 0.05 },
  };
}

/**
 * A short settle when `pulse` changes (a new range was picked), staggered by
 * `index` like the opening. Not on first render: `rise` covers that.
 */
function usePulse(pulse: unknown, index: number) {
  const [scope, run] = useAnimate<HTMLDivElement>();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!scope.current) return;
    void run(
      scope.current,
      { scale: [0.985, 1], opacity: [0.55, 1] },
      { duration: 0.45, ease: EASE, delay: index * 0.035 },
    );
  }, [pulse]);
  return scope;
}

function Card({
  index,
  title,
  aside,
  pulse,
  children,
}: {
  index: number;
  title: string;
  aside?: ReactNode;
  /** Changes when the data behind the card does, to replay its content. */
  pulse?: unknown;
  children: ReactNode;
}) {
  const scope = usePulse(pulse, index);
  return (
    <motion.section {...rise(index)} className="flex min-w-0">
      {/* The pulse runs on this inner box: the section's own transform belongs to `rise`. */}
      <div ref={scope} className="flex min-w-0 flex-1 flex-col gap-5 rounded-2xl bg-muted/40 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">{title}</h2>
          {aside}
        </div>
        {/* Keyed, so bars regrow and rows stagger in again for the new range. */}
        <motion.div
          key={String(pulse)}
          className="flex min-w-0 flex-1 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {children}
        </motion.div>
      </div>
    </motion.section>
  );
}

function Loading() {
  return (
    <div className="flex h-48 items-center justify-center text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
    </div>
  );
}

/** A figure that counts from its last value to the new one. */
function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: 0.8,
      ease: EASE,
      onUpdate: (latest) => {
        from.current = latest;
        setShown(latest);
      },
    });
    return () => controls.stop();
  }, [value]);
  return <>{format(shown)}</>;
}

function Stat({
  index,
  pulse,
  label,
  value,
  format,
  delta,
  note,
  upIsGood,
}: {
  index: number;
  pulse?: unknown;
  label: string;
  /** Undefined shows a dash. */
  value: number | undefined;
  format: (n: number) => string;
  delta?: number;
  note: string;
  /** Undefined: neither direction is good or bad. */
  upIsGood?: boolean;
}) {
  const shown = delta != null && Math.abs(delta) >= 0.05;
  const good = shown && upIsGood != null ? (delta > 0) === upIsGood : undefined;
  const scope = usePulse(pulse, index);
  return (
    <motion.div {...rise(index)} className="flex min-w-0">
      <div ref={scope} className="flex min-w-0 flex-1 flex-col gap-2 rounded-2xl bg-muted/40 p-5 sm:p-6">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
          {value != null ? <AnimatedNumber value={value} format={format} /> : "—"}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {shown && (
            <span
              className={cn(
                "flex items-center gap-0.5 font-medium tabular-nums",
                good === true && "text-emerald-600 dark:text-emerald-400",
                good === false && "text-red-600 dark:text-red-400",
                good === undefined && "text-foreground",
              )}
            >
              {delta > 0 ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />}
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%
            </span>
          )}
          <span className="truncate">{note}</span>
        </span>
      </div>
    </motion.div>
  );
}

/** Input, output and cache: three steps of one neutral, darkest at the baseline. */
const SEGMENTS = [
  { key: "input", label: "Input", fill: "bg-foreground" },
  { key: "output", label: "Output", fill: "bg-muted-foreground/55" },
  { key: "cache", label: "Cache", fill: "bg-muted-foreground/25" },
] as const;

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {SEGMENTS.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[3px]", s.fill)} /> {s.label}
        </span>
      ))}
    </div>
  );
}

function dayLabel(day: number, count: number) {
  const date = new Date(day);
  return count <= 7
    ? date.toLocaleDateString("en-US", { weekday: "short" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const totalOf = (split: TokenSplit) => split.input + split.output + split.cache;

/** Stacked segments, top one rounded; 2px gaps between them. */
function Stack({ split, className }: { split: TokenSplit; className?: string }) {
  const present = [...SEGMENTS].reverse().filter((s) => split[s.key] > 0);
  return (
    <span className={cn("flex w-full flex-col gap-[2px]", className)}>
      {present.map((s, i) => (
        <span key={s.key} className={cn("w-full min-h-[2px]", s.fill, i === 0 && "rounded-t-[4px]")} style={{ flexGrow: split[s.key] }} />
      ))}
    </span>
  );
}

function DailyChart({ daily }: { daily: DayUsage[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map(totalOf));
  const count = daily.length;
  // Label every bar when they fit, otherwise about eight evenly spaced ones.
  const every = count <= 14 ? 1 : Math.ceil(count / 8);
  const valuesOnCaps = count <= 14;
  const active = hover != null ? daily[hover] : undefined;
  // Fixed gaps would outgrow the card at 90 bars; they shrink as bars multiply.
  const gap = count <= 14 ? "gap-1.5 sm:gap-2" : count <= 31 ? "gap-[2px] sm:gap-1" : "gap-px";
  const centre = (index: number) => ((index + 0.5) / count) * 100;
  // Near an edge, anchor to that edge instead of centring, so nothing leaves the card.
  const shift = (index: number) => {
    const at = centre(index);
    return at < 12 ? "0%" : at > 88 ? "-100%" : "-50%";
  };

  if (daily.every((d) => totalOf(d) === 0)) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No replies in this period yet.
      </p>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className={cn("relative flex h-56 items-end", gap)} onMouseLeave={() => setHover(null)}>
        {daily.map((d, index) => {
          const total = totalOf(d);
          return (
            <button
              key={d.day}
              type="button"
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
              aria-label={`${dayLabel(d.day, 30)}: ${exact.format(d.input)} input, ${exact.format(d.output)} output, ${exact.format(d.cache)} cache tokens`}
            >
              {valuesOnCaps && total > 0 && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 + index * 0.03 }}
                  className="mb-1.5 text-[11px] tabular-nums text-muted-foreground"
                >
                  {compact.format(total)}
                </motion.span>
              )}
              <motion.span
                className="flex w-full max-w-12"
                initial={{ height: "0%" }}
                animate={{ height: `${(total / max) * 100}%`, opacity: hover != null && hover !== index ? 0.45 : 1 }}
                transition={{
                  height: { type: "spring", stiffness: 140, damping: 22, delay: 0.1 + index * 0.025 },
                  opacity: { duration: 0.15 },
                }}
              >
                {total > 0 && <Stack split={d} />}
              </motion.span>
            </button>
          );
        })}
        <AnimatePresence>
          {active && hover != null && (
            <motion.div
              key="tip"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, left: `${centre(hover)}%`, x: shift(hover) }}
              exit={{ opacity: 0, y: 4 }}
              transition={{
                duration: 0.16,
                left: { type: "spring", stiffness: 400, damping: 34 },
                x: { type: "spring", stiffness: 400, damping: 34 },
              }}
              className="pointer-events-none absolute top-0 z-10 w-max rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            >
              <p className="mb-1 font-medium">
                {new Date(active.day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </p>
              {SEGMENTS.map((s) => (
                <p key={s.key} className="tabular-nums">
                  <span className="font-semibold">{exact.format(active[s.key])}</span>{" "}
                  <span className="text-muted-foreground">{s.label.toLowerCase()}</span>
                </p>
              ))}
              <p className="tabular-nums text-muted-foreground">
                {active.requests} {active.requests === 1 ? "reply" : "replies"} · {money(active.cost)}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* Placed by position, not one slot per bar: a date is wider than a 90-day bar. */}
      <div className="relative h-4 overflow-hidden">
        {daily.map((d, index) =>
          index % every === 0 ? (
            <span
              key={d.day}
              className="absolute top-0 whitespace-nowrap text-xs text-muted-foreground"
              style={{ left: `${centre(index)}%`, transform: `translateX(${shift(index)})` }}
            >
              {dayLabel(d.day, count)}
            </span>
          ) : null,
        )}
      </div>
      {/* The same figures as a table, for screen readers. */}
      <table className="sr-only">
        <caption>Daily token usage</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache</th>
            <th>Replies</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <td>{new Date(d.day).toDateString()}</td>
              <td>{d.input}</td>
              <td>{d.output}</td>
              <td>{d.cache}</td>
              <td>{d.requests}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meter({ value, max, delay = 0 }: { value: number; max: number; delay?: number }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <motion.div
        className="h-full rounded-full bg-foreground"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(share * 100, value > 0 ? 1.5 : 0)}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 22, delay }}
      />
    </div>
  );
}

/** List items fade in after their card. */
function itemIn(index: number, base = 0.25) {
  return {
    initial: { opacity: 0, x: -8 },
    animate: { opacity: 1, x: 0 },
    transition: { duration: 0.3, ease: EASE, delay: base + index * 0.04 },
  };
}

function ModelName({ row, small }: { row: ModelRow; small?: boolean }) {
  return (
    <>
      <ProviderLogo logo={row.provider} name={providerName(row.provider)} className={small ? "size-3.5" : "size-4"} />
      <span className={cn("min-w-0 flex-1 truncate", small ? "text-[13px]" : "text-sm")} title={row.key}>
        {row.model}
        <span className="ml-2 text-xs text-muted-foreground">{providerName(row.provider)}</span>
      </span>
    </>
  );
}

const MODEL_ROWS = 6;
/** Fewer, so the card stays about as tall as the chart beside it. */
const MODEL_TOKEN_ROWS = 5;

function ModelTokens({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No replies in this period.</p>;
  const sorted = [...rows].sort((a, b) => b.tokens - a.tokens);
  const max = sorted[0].tokens || 1;
  const rest = sorted.slice(MODEL_TOKEN_ROWS);
  return (
    <ul className="flex flex-col gap-3">
      {sorted.slice(0, MODEL_TOKEN_ROWS).map((row, index) => (
        <motion.li key={row.key} {...itemIn(index, 0.15)} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <ModelName row={row} small />
            <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">
              <AnimatedNumber value={row.tokens} format={(n) => compact.format(n)} />
            </span>
          </div>
          {/* Length is the model's share of the busiest one; segments split it. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="flex h-full gap-px overflow-hidden rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max((row.tokens / max) * 100, 1.5)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.2 + index * 0.04 }}
            >
              {SEGMENTS.filter((s) => row[s.key] > 0).map((s) => (
                <span key={s.key} className={cn("h-full min-w-[2px]", s.fill)} style={{ flexGrow: row[s.key] }} />
              ))}
            </motion.div>
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {compact.format(row.input)} in · {compact.format(row.output)} out · {compact.format(row.cache)} cache ·{" "}
            {row.requests} {row.requests === 1 ? "reply" : "replies"}
          </span>
        </motion.li>
      ))}
      {rest.length > 0 && (
        <li className="text-[11px] text-muted-foreground">
          +{rest.length} more · {compact.format(rest.reduce((sum, r) => sum + r.tokens, 0))} tokens
        </li>
      )}
    </ul>
  );
}

function CostByModel({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No replies in this period.</p>;
  const byCost = rows.some((r) => r.cost > 0);
  const max = Math.max(...rows.map((r) => (byCost ? r.cost : r.tokens)));
  return (
    <ul className="flex flex-col gap-5">
      {rows.slice(0, MODEL_ROWS).map((row, index) => (
        <motion.li key={row.key} {...itemIn(index, 0.35)} className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <ModelName row={row} />
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
              {row.subscription ? (
                <span className="font-sans text-xs font-normal text-muted-foreground">subscription</span>
              ) : (
                <>
                  {row.estimated && "~"}
                  <AnimatedNumber value={row.cost} format={(n) => money(n)} />
                </>
              )}
            </span>
          </div>
          <Meter value={byCost ? row.cost : row.tokens} max={max} delay={0.4 + index * 0.05} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {compact.format(row.tokens)} tokens · {row.requests} {row.requests === 1 ? "reply" : "replies"}
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

function TopQueries({ rows }: { rows: TopQuery[] }) {
  const chats = useChatSessions();
  const existing = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No replies in this period.</p>;
  return (
    <ul className="flex flex-col divide-y">
      {rows.slice(0, MODEL_ROWS).map((row, index) => {
        const open = row.chatId && existing.has(row.chatId);
        const title = row.title || "Untitled prompt";
        return (
          <motion.li key={row.id} {...itemIn(index, 0.4)} className="flex items-start gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {open ? (
                <Link to={`/chat/${row.chatId}`} className="truncate text-sm hover:underline" title={title}>
                  {title}
                </Link>
              ) : (
                <span className="truncate text-sm" title={title}>
                  {title}
                </span>
              )}
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                <span className="max-w-48 truncate rounded-full bg-background px-2 py-0.5 text-foreground">{row.ref.model}</span>
                <span className="font-mono tabular-nums">{exact.format(row.totalTokens)} tok</span>
                <span>{ago(row.createdAt)}</span>
                {!open && row.chatId && <span className="italic">chat deleted</span>}
              </span>
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
              {row.known ? `${row.estimated ? "~" : ""}${money(row.cost)}` : "—"}
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}

type AccountState = { loading: boolean; account?: ProviderAccount; error?: string };

function ProviderAccounts({ days, refreshKey }: { days: number; refreshKey: number }) {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const vault = useVaultStatus();
  const [adminVersion, setAdminVersion] = useState(0);
  const [states, setStates] = useState<Record<string, AccountState>>({});

  // Shown when the account API can be called: a key for the plain ones, an
  // admin key (or at least a normal key, to offer adding one) for the others.
  const providers = useMemo(
    () =>
      ACCOUNT_PROVIDERS.filter((p) => {
        const hasKey = Boolean(configs[p.id]?.apiKey?.trim()) || envKeys.includes(p.id);
        return p.admin ? hasKey || Boolean(getAdminKey(p.id)) : hasKey;
      }),
    // `vault`/`adminVersion`: admin keys live in the keychain, read on change.
    [configs, envKeys, vault, adminVersion],
  );

  const load = useCallback(
    (id: string) => {
      const def = ACCOUNT_PROVIDERS.find((p) => p.id === id);
      if (def?.admin && !getAdminKey(id)) {
        setStates((prev) => ({ ...prev, [id]: { loading: false } }));
        return;
      }
      setStates((prev) => ({ ...prev, [id]: { ...prev[id], loading: true, error: undefined } }));
      fetchProviderAccount(id, days)
        .then((account) => setStates((prev) => ({ ...prev, [id]: { loading: false, account } })))
        .catch((error) => setStates((prev) => ({ ...prev, [id]: { loading: false, error: String(error) } })));
    },
    [days],
  );

  useEffect(() => {
    for (const p of providers) load(p.id);
  }, [providers, load, refreshKey]);

  if (providers.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Add a key for OpenRouter, DeepSeek or Moonshot in Settings → Models to see their credit and balance here. OpenAI
        and Anthropic show organisation-wide usage and cost with an admin key.
      </p>
    );
  }

  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map((p, index) => (
        <motion.li key={p.id} {...itemIn(index, 0.45)} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <ProviderLogo logo={p.id} name={providerName(p.id)} className="size-4" />
            <span className="flex-1 text-sm">{providerName(p.id)}</span>
            {states[p.id]?.loading && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <AccountBody
            state={states[p.id]}
            admin={p.admin}
            keyUrl={"keyUrl" in p ? p.keyUrl : undefined}
            onRetry={() => load(p.id)}
            onAdminKey={(key) => {
              setAdminKey(p.id, key);
              setAdminVersion((v) => v + 1);
              load(p.id);
            }}
            hasAdminKey={Boolean(getAdminKey(p.id))}
          />
        </motion.li>
      ))}
    </ul>
  );
}

function AccountBody({
  state,
  admin,
  keyUrl,
  hasAdminKey,
  onRetry,
  onAdminKey,
}: {
  state?: AccountState;
  admin: boolean;
  keyUrl?: string;
  hasAdminKey: boolean;
  onRetry: () => void;
  onAdminKey: (key: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (admin && (!hasAdminKey || editing)) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAdminKey(draft);
          setDraft("");
          setEditing(false);
        }}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Usage and cost reports need an organisation admin key.{" "}
          {keyUrl && (
            <button
              type="button"
              onClick={() => void openUrl(keyUrl)}
              className="inline-flex items-center gap-0.5 underline"
            >
              Create one <ExternalLinkIcon className="size-3" />
            </button>
          )}
        </p>
        <div className="flex gap-2">
          <SecretInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Admin key" className="h-8 text-xs" />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            Save
          </Button>
        </div>
        {editing && (
          <div className="flex gap-3 text-xs">
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="text-destructive hover:underline"
              onClick={() => {
                onAdminKey(undefined);
                setEditing(false);
              }}
            >
              Remove key
            </button>
          </div>
        )}
      </form>
    );
  }

  if (state?.error) {
    return (
      <div className="flex flex-col gap-1.5 text-xs">
        <p className="leading-relaxed text-destructive">{state.error}</p>
        <div className="flex gap-3">
          <button type="button" className="text-muted-foreground hover:underline" onClick={onRetry}>
            Try again
          </button>
          {admin && (
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEditing(true)}>
              Change admin key
            </button>
          )}
        </div>
      </div>
    );
  }

  const account = state?.account;
  if (!account) return <div className="h-2 animate-pulse rounded-full bg-muted" />;
  const currency = account.currency || "USD";

  return (
    <div className="flex flex-col gap-2">
      {account.kind === "credits" && account.used != null && (
        <>
          {account.limit ? <Meter value={account.used} max={account.limit} /> : null}
          <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
            <span>{money(account.used, currency)} used</span>
            <span>{account.limit ? `${money(account.limit, currency)} limit` : "no limit"}</span>
          </div>
        </>
      )}
      {account.kind === "balance" && account.remaining != null && (
        <p className="text-2xl font-semibold tracking-tight">
          {money(account.remaining, currency)} <span className="text-xs font-normal text-muted-foreground">balance</span>
        </p>
      )}
      {account.kind === "organization" && (
        <>
          <p className="text-2xl font-semibold tracking-tight">
            {money(account.periodCost ?? 0, currency)}{" "}
            <span className="text-xs font-normal text-muted-foreground">billed</span>
          </p>
          <OrgSpark daily={account.daily} />
          <div className="flex flex-wrap gap-x-3 font-mono text-xs tabular-nums text-muted-foreground">
            <span>{compact.format(account.periodInputTokens ?? 0)} in</span>
            <span>{compact.format(account.periodOutputTokens ?? 0)} out</span>
            {account.periodRequests != null && <span>{exact.format(account.periodRequests)} req</span>}
          </div>
        </>
      )}
      {account.detail && <p className="text-xs text-muted-foreground">{account.detail}</p>}
      {admin && (
        <button
          type="button"
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
          onClick={() => setEditing(true)}
        >
          <KeyRoundIcon className="size-3" /> Admin key
        </button>
      )}
    </div>
  );
}

/** Daily billed cost as a thin column strip; the exact day shows on hover. */
function OrgSpark({ daily }: { daily: ProviderAccount["daily"] }) {
  const max = Math.max(0, ...daily.map((d) => d.cost));
  if (daily.length < 2 || max <= 0) return null;
  return (
    <div className="flex h-10 items-end gap-[2px]" aria-hidden>
      {daily.map((d) => (
        <span
          key={d.day}
          title={`${new Date(d.day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}: ${money(d.cost)}`}
          className="min-w-0 flex-1 rounded-t-[2px] bg-foreground/80"
          style={{ height: `${Math.max((d.cost / max) * 100, d.cost > 0 ? 4 : 1)}%` }}
        />
      ))}
    </div>
  );
}
