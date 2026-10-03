"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatSessions } from "@/features/chat-history";
import { getProject } from "@/features/projects";
import { ProviderLogo } from "@/features/providers";
import { modelRefOf } from "@/features/usage/stats";
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon, FolderIcon, SparklesIcon, ZapIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildWeeklyRecap, startOfWeek } from "./recap";
import { useTimeSavedRates } from "./settings-store";
import { closeWeeklyRecap, useWeeklyRecapOpen, useWeeklyRecapStartOffset } from "./weekly-recap-store";

const DAY = 24 * 60 * 60 * 1000;

function formatMs(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes === 0) return "0 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function formatMinutes(minutes: number) {
  if (minutes === 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function weekLabel(start: number, end: number) {
  const fmt = (d: number) =>
    new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt(start)} – ${fmt(end - 1)}`;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function formatCost(usd: number) {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`;
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-muted/50 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-xl font-semibold tracking-tight tabular-nums">{value}</span>
      {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function WeeklyRecapDialog() {
  const open = useWeeklyRecapOpen();
  const rates = useTimeSavedRates();
  const sessions = useChatSessions();
  const startOffset = useWeeklyRecapStartOffset();
  const [weekOffset, setWeekOffset] = useState(startOffset);
  // +1 going back in time, -1 forward: which way the week slides.
  const [direction, setDirection] = useState(0);

  const currentStart = useMemo(() => startOfWeek(Date.now()), [open]);
  // Half a day into the target week, then back to its Monday: stays on
  // Monday 00:00 across a daylight-saving change.
  const viewStart = useMemo(
    () => startOfWeek(currentStart - weekOffset * 7 * DAY + DAY / 2),
    [currentStart, weekOffset],
  );

  useEffect(() => {
    if (open) setWeekOffset(startOffset);
  }, [open, startOffset]);

  const recap = useMemo(
    () => buildWeeklyRecap(sessions, viewStart, rates),
    [sessions, viewStart, rates],
  );

  const go = (step: 1 | -1) => {
    setDirection(step);
    setWeekOffset((v) => Math.max(0, v + step));
  };

  const projects = recap.topProjects.filter((p) => p.projectId);
  const summary = [
    plural(recap.tasks, "task"),
    recap.filesCreated ? `${plural(recap.filesCreated, "file")} created` : "",
    recap.filesModified ? `${recap.filesModified} edited` : "",
    recap.commands ? plural(recap.commands, "command") : "",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeWeeklyRecap()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-5 overflow-hidden sm:max-w-xl">
        <DialogHeader className="min-w-0 gap-3 pr-8">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ZapIcon className="size-4 text-amber-500" />
            Weekly recap
          </DialogTitle>
          {/* The week, with arrows either side: one control, not three. */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => go(1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <DialogDescription asChild>
              <div className="min-w-0 flex-1 text-center">
                <p className="text-sm font-medium text-foreground">
                  {weekOffset === 0 ? "This week" : weekOffset === 1 ? "Last week" : `${weekOffset} weeks ago`}
                </p>
                <p className="text-xs text-muted-foreground">{weekLabel(recap.weekStart, recap.weekEnd)}</p>
              </div>
            </DialogDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Next week"
              disabled={weekOffset === 0}
              onClick={() => go(-1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={viewStart}
            custom={direction}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: d * -24 }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: d * 24 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: MALI_EASE }}
            className="flex min-h-0 flex-col gap-5 overflow-y-auto"
          >
            {recap.tasks === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted/40 px-6 py-12 text-center">
                <SparklesIcon className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">No agent work {weekOffset === 0 ? "yet this week" : "that week"}</p>
                <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Finished Cowork tasks are counted here. A new recap opens by itself every Monday.
                </p>
              </div>
            ) : (
              <>
                {/* One headline: the time the agents saved. */}
                <section className="flex flex-col gap-1 rounded-2xl bg-amber-500/[0.07] px-5 py-4">
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Time saved (estimate)</span>
                  <span className="text-4xl font-semibold tracking-tight">~{formatMinutes(recap.minutesSaved)}</span>
                  <span className="text-sm text-muted-foreground">{summary.join(" · ")}</span>
                </section>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile label="Tasks" value={recap.tasks} />
                  <Tile
                    label="Files"
                    value={recap.filesCreated + recap.filesModified}
                    sub={`${recap.filesCreated} new · ${recap.filesModified} edited`}
                  />
                  <Tile label="Agent time" value={formatMs(recap.agentMs)} />
                  <Tile
                    label="Cost"
                    value={formatCost(recap.cost)}
                    sub={`${compact.format(recap.totalTokens)} tokens`}
                  />
                </div>

                <div className={cn("grid gap-5", projects.length > 0 && "sm:grid-cols-2")}>
                  <Ranking
                    title="Models"
                    total={recap.tasks}
                    items={recap.topModels.map((m) => {
                      const ref = modelRefOf(m.modelId);
                      return {
                        key: m.modelId,
                        label: ref.model,
                        icon: <ProviderLogo logo={ref.provider} name={ref.provider} className="size-3.5" />,
                        count: m.tasks,
                      };
                    })}
                  />
                  {/* Only when some tasks were in a project; "No project" alone says nothing. */}
                  {projects.length > 0 && (
                    <Ranking
                      title="Projects"
                      total={recap.tasks}
                      items={recap.topProjects.map((p) => ({
                        key: p.projectId ?? "none",
                        label: p.projectId ? getProject(p.projectId)?.name ?? "Unknown project" : "No project",
                        icon: <FolderIcon className="size-3.5 text-muted-foreground" />,
                        count: p.tasks,
                      }))}
                    />
                  )}
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Time saved is estimated from the files and commands each task handled.{" "}
                  <Link to="/settings?tab=receipt" onClick={closeWeeklyRecap} className="underline hover:text-foreground">
                    Adjust the estimate
                  </Link>
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function Ranking({
  title,
  total,
  items,
}: {
  title: string;
  total: number;
  items: { key: string; label: string; icon: ReactNode; count: number }[];
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data for this week.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => (
            <li key={item.key} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                {item.icon}
                <span className="min-w-0 flex-1 truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {plural(item.count, "task")}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-foreground/80"
                  initial={{ width: 0 }}
                  animate={{ width: `${total > 0 ? (item.count / total) * 100 : 0}%` }}
                  transition={{ duration: 0.6, ease: MALI_EASE, delay: 0.1 + index * 0.06 }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { useWeeklyRecapAutoOpen } from "./weekly-recap-store";
export { requestWeeklyRecapOpen } from "./weekly-recap-store";
