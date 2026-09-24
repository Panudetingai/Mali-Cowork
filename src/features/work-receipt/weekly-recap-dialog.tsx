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
import { cn } from "@/lib/utils";
import { EmptyState } from "@/pages/settings/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CoinsIcon,
  CommandIcon,
  FilePlusIcon,
  FilesIcon,
  PenLineIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildWeeklyRecap, startOfWeek } from "./recap";
import { useTimeSavedRates } from "./settings-store";
import { closeWeeklyRecap, useWeeklyRecapOpen } from "./weekly-recap-store";

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

function modelName(modelId: string) {
  const parts = modelId.split("/");
  return parts[parts.length - 1] ?? modelId;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "neutral" | "emerald" | "amber" | "sky";
}) {
  const border =
    tone === "emerald"
      ? "border-emerald-500/20"
      : tone === "amber"
        ? "border-amber-500/20"
        : tone === "sky"
          ? "border-sky-500/20"
          : "border-border/60";
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-4", border)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function WeeklyRecapDialog() {
  const open = useWeeklyRecapOpen();
  const rates = useTimeSavedRates();
  const sessions = useChatSessions();
  const [weekOffset, setWeekOffset] = useState(0);

  const currentStart = useMemo(() => startOfWeek(Date.now()), []);
  const viewStart = useMemo(() => currentStart - weekOffset * 7 * DAY, [currentStart, weekOffset]);

  useEffect(() => {
    if (open) setWeekOffset(0);
  }, [open]);

  const recap = useMemo(
    () => buildWeeklyRecap(sessions, viewStart, rates),
    [sessions, viewStart, rates],
  );

  const handleClose = () => {
    closeWeeklyRecap(viewStart);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-5 sm:max-w-3xl">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="flex items-center gap-2">
            <ZapIcon className="size-5 text-amber-500" />
            Weekly recap
          </DialogTitle>
          <DialogDescription>{weekLabel(recap.weekStart, recap.weekEnd)}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => setWeekOffset((v) => v + 1)}
          >
            <ChevronLeftIcon className="size-4" />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {weekOffset === 0 ? "This week" : `${weekOffset} week${weekOffset === 1 ? "" : "s"} ago`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={weekOffset === 0}
            onClick={() => setWeekOffset((v) => Math.max(0, v - 1))}
          >
            Next
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>

        {recap.tasks === 0 ? (
          <EmptyState
            icon={<SparklesIcon />}
            title="No agent work this week"
            description="Cowork turns you finish will show up here every Monday."
          />
        ) : (
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={FilesIcon} label="Tasks" value={recap.tasks} tone="sky" />
              <StatCard icon={FilePlusIcon} label="Files created" value={recap.filesCreated} tone="emerald" />
              <StatCard icon={PenLineIcon} label="Files modified" value={recap.filesModified} tone="amber" />
              <StatCard icon={CommandIcon} label="Commands" value={recap.commands} />
              <StatCard
                icon={ClockIcon}
                label="Agent time"
                value={formatMs(recap.agentMs)}
              />
              <StatCard
                icon={CoinsIcon}
                label="Cost"
                value={`$${recap.cost.toFixed(3)}`}
                sub={`${recap.totalTokens.toLocaleString()} tokens`}
              />
              <StatCard
                icon={ZapIcon}
                label="Saved (est.)"
                value={`~${formatMinutes(recap.minutesSaved)}`}
                tone="amber"
              />
              <StatCard
                icon={SparklesIcon}
                label="Top model"
                value={
                  recap.topModels[0]
                    ? modelName(recap.topModels[0].modelId)
                    : "—"
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TopList
                title="Top projects"
                items={recap.topProjects.map((p) => ({
                  key: p.projectId ?? "none",
                  label: p.projectId ? getProject(p.projectId)?.name ?? "Unknown project" : "No project",
                  count: p.tasks,
                }))}
              />
              <TopList
                title="Top models"
                items={recap.topModels.map((m) => ({
                  key: m.modelId,
                  label: modelName(m.modelId),
                  count: m.tasks,
                }))}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TopList({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; count: number }[];
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data for this week.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <span className="truncate" title={item.label}>
                  {item.label}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { useWeeklyRecapAutoOpen } from "./weekly-recap-store";
export { requestWeeklyRecapOpen } from "./weekly-recap-store";
