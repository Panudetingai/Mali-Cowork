import {
  ModelSelectorLogo,
  type ModelSelectorLogoProps,
} from "@/components/ai-elements/model-selector";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@/components/animate-ui/primitives/radix/popover";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/animate-ui/components/radix/sidebar";
import { useChatSessions } from "@/features/chat-history";
import { useOpencode } from "@/features/opencode";
import { aggregateTokenUsage, type ModelUsageTotals, type UsageTotals } from "@/features/usage";
import { cn } from "@/lib/utils";
import { modelIsPaid, modelMetaFromId } from "@/pages/chat/models";
import { CoinsIcon, Gauge } from "lucide-react";
import { motion, useMotionValueEvent, useSpring } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });
const exact = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

/** The slices of the total, in the order they read best. */
const BREAKDOWN = [
  { key: "inputTokens", label: "Input", bar: "bg-sky-500/80" },
  { key: "outputTokens", label: "Output", bar: "bg-emerald-500/80" },
  { key: "reasoningTokens", label: "Reasoning", bar: "bg-violet-500/80" },
  { key: "cacheReadTokens", label: "Cache read", bar: "bg-zinc-400/70" },
] as const satisfies readonly { key: keyof UsageTotals; label: string; bar: string }[];

export function SidebarTokenFooter() {
  const sessions = useChatSessions();
  const [open, setOpen] = useState(false);
  const { totals, byModel } = useMemo(() => aggregateTokenUsage(sessions), [sessions]);

  if (totals.totalTokens <= 0 && totals.cost <= 0) return null;

  return (
    <SidebarFooter className="border-t border-sidebar-border">
      <Popover open={open} onOpenChange={setOpen}>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* `asChild` so the popover owns the real <button>: SidebarMenuButton
                otherwise renders it inside a HighlightItem wrapper div. */}
            <SidebarMenuButton
              asChild
              size="lg"
              isActive={open}
              tooltip={`Total tokens — ${compact.format(totals.totalTokens)}`}
            >
              <PopoverTrigger className="group/token group-data-[collapsible=icon]:justify-center">
                <Gauge
                  strokeWidth={1.75}
                  className="transition-transform duration-300 group-hover/token:scale-110 dark:text-amber-400/90"
                />
                <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-[11px] font-medium text-sidebar-foreground/70">
                    Total tokens
                  </span>
                  <span className="flex items-baseline gap-2">
                    <AnimatedCount
                      value={totals.totalTokens}
                      className="text-sm font-semibold tabular-nums"
                    />
                    {totals.cost > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {usd.format(totals.cost)}
                      </span>
                    )}
                  </span>
                </div>
                <Sparkline models={byModel} total={totals.totalTokens} />
              </PopoverTrigger>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <PopoverPortal>
          <PopoverContent
            side="right"
            align="end"
            sideOffset={10}
            collisionPadding={12}
            initial={{ opacity: 0, scale: 0.94, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.96, x: -4 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className={cn(
              "z-50 w-80 origin-left overflow-hidden rounded-2xl border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl",
              "outline-hidden",
            )}
          >
            <UsagePanel totals={totals} byModel={byModel} />
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </SidebarFooter>
  );
}

function UsagePanel({ totals, byModel }: { totals: UsageTotals; byModel: ModelUsageTotals[] }) {
  const opencode = useOpencode();
  const slices = BREAKDOWN.map((slice) => ({ ...slice, value: totals[slice.key] })).filter(
    (slice) => slice.value > 0,
  );
  const sliceTotal = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;

  return (
    <div className="flex max-h-[min(30rem,70vh)] flex-col">
      <header className="flex items-start gap-3 border-b bg-gradient-to-br from-amber-500/10 to-transparent px-4 py-3.5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <CoinsIcon strokeWidth={1.75} className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Total tokens — all chats
          </p>
          <div className="flex items-baseline gap-2">
            <AnimatedCount value={totals.totalTokens} className="text-2xl font-semibold tabular-nums" />
            {totals.cost > 0 && (
              <span className="text-sm tabular-nums text-muted-foreground">
                {usd.format(totals.cost)}
              </span>
            )}
          </div>
          <p className="text-[11px] tabular-nums text-muted-foreground/70">
            {exact.format(totals.totalTokens)} tokens
          </p>
        </div>
      </header>

      {slices.length > 0 && (
        <section className="border-b px-4 py-3">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
            {slices.map((slice, index) => (
              <motion.span
                key={slice.key}
                className={cn("h-full first:rounded-l-full last:rounded-r-full", slice.bar)}
                initial={{ width: 0 }}
                animate={{ width: `${(slice.value / sliceTotal) * 100}%` }}
                transition={{ type: "spring", stiffness: 140, damping: 24, delay: 0.06 + index * 0.05 }}
              />
            ))}
          </div>
          <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {slices.map((slice, index) => (
              <motion.li
                key={slice.key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.04, duration: 0.2 }}
                className="flex items-center gap-1.5 text-[11px]"
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", slice.bar)} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
                <span className="shrink-0 tabular-nums font-medium">{compact.format(slice.value)}</span>
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      <section className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
          By model
        </p>
        <ul className="space-y-1">
          {byModel.map((row, index) => {
            const meta = modelMetaFromId(row.modelId, opencode.models);
            const share = totals.totalTokens > 0 ? row.totalTokens / totals.totalTokens : 0;
            return (
              <motion.li
                key={row.modelId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 + index * 0.045, duration: 0.24 }}
                className="rounded-xl px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <div className="flex items-center gap-2">
                  <ModelSelectorLogo
                    provider={meta.provider as ModelSelectorLogoProps["provider"]}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{meta.name}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                    {Math.round(share * 100)}%
                  </span>
                  <BillingBadge free={meta.free} paid={modelIsPaid(meta)} cost={row.cost} />
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500/85 to-amber-400/55"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(share * 100, 2)}%` }}
                    transition={{ type: "spring", stiffness: 130, damping: 22, delay: 0.16 + index * 0.05 }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                  <span>in {compact.format(row.inputTokens)}</span>
                  <span>out {compact.format(row.outputTokens)}</span>
                  <span>{row.turns} {row.turns === 1 ? "reply" : "replies"}</span>
                  <span className="ml-auto font-medium text-foreground/80">
                    Σ {compact.format(row.totalTokens)}
                  </span>
                </div>
              </motion.li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** A one-bar-per-model strip, so the footer hints at the split before opening. */
function Sparkline({
  models,
  total,
  className,
}: {
  models: ModelUsageTotals[];
  total: number;
  className?: string;
}) {
  if (models.length === 0 || total <= 0) return null;
  return (
    // A div, not a span: SidebarMenuButton truncates its last span child.
    <div
      aria-hidden
      className={cn(
        "flex h-6 shrink-0 items-end gap-px group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      {models.slice(0, 5).map((row, index) => (
        <motion.span
          key={row.modelId}
          className="w-1 rounded-sm bg-amber-500/45"
          initial={{ height: 2 }}
          animate={{ height: `${Math.max((row.totalTokens / total) * 100, 12)}%` }}
          transition={{ type: "spring", stiffness: 150, damping: 20, delay: index * 0.04 }}
        />
      ))}
    </div>
  );
}

function BillingBadge({ free, paid, cost }: { free?: boolean; paid: boolean; cost: number }) {
  if (free) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        Free
      </span>
    );
  }
  if (paid) {
    return (
      <span className="shrink-0 rounded-full bg-amber-100/90 px-1.5 py-px text-[9px] font-medium text-amber-800 dark:bg-amber-900/35 dark:text-amber-200">
        {cost > 0 ? usd.format(cost) : "Paid"}
      </span>
    );
  }
  return null;
}

function AnimatedCount({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const spring = useSpring(value, { stiffness: 90, damping: 18 });
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  useMotionValueEvent(spring, "change", (v) => {
    if (ref.current) ref.current.textContent = compact.format(Math.round(v));
  });
  return (
    <span ref={ref} className={className}>
      {compact.format(value)}
    </span>
  );
}
