"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRightIcon, BellRingIcon, InboxIcon, LoaderIcon, PlayIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TaskStatus } from "./types";
import { useChatTaskViews, useInboxCount, type TaskView } from "./views";

const STATUS_DOT: Record<TaskStatus, string> = {
  "needs-you": "bg-amber-500",
  ready: "bg-emerald-500",
  running: "bg-sky-500",
  queued: "bg-muted-foreground/50",
  failed: "bg-red-500",
  interrupted: "bg-red-500",
  done: "bg-muted-foreground/40",
  accepted: "bg-emerald-500/70",
  undone: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  "needs-you": "Needs you",
  ready: "Ready to review",
  running: "Running",
  queued: "Waiting",
  failed: "Failed",
  interrupted: "Interrupted",
  done: "Finished",
  accepted: "Kept",
  undone: "Undone",
};

/** Still in flight, or waiting on the user: what the button's badge counts. */
const ACTIVE: TaskStatus[] = ["needs-you", "running", "queued", "ready"];
const MAX_ROWS = 8;
const MOD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+";

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

interface InboxDropdownButtonProps {
  /** The chat the composer belongs to; only the tasks it started are listed. Undefined: a new chat. */
  chatId?: string;
  onRunBackground?: () => void;
  canRunBackground?: boolean;
  className?: string;
  title?: string;
}

/**
 * The composer's Inbox button: the background tasks *this* chat started,
 * each one a click away from its own chat. Other chats' tasks stay in the
 * Inbox page, so one conversation's work never mixes with another's.
 */
export function InboxDropdownButton({
  chatId,
  onRunBackground,
  canRunBackground,
  className,
  title,
}: InboxDropdownButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const views = useChatTaskViews(chatId);
  const total = useInboxCount();
  const needsYou = views.filter((v) => v.status === "needs-you").length;
  const active = views.filter((v) => ACTIVE.includes(v.status)).length;
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCount = useRef(0);

  const enter = useCallback(() => {
    hoverCount.current += 1;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setOpen(true);
  }, []);

  const leave = useCallback(() => {
    hoverCount.current = Math.max(0, hoverCount.current - 1);
    if (hoverCount.current > 0) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (hoverCount.current === 0) setOpen(false);
    }, 200);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const shown = views.slice(0, MAX_ROWS);
  const hidden = views.length - shown.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div onMouseEnter={enter} onMouseLeave={leave}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={title ?? t("runInBackground")}
            aria-label={needsYou > 0 ? `${t("inbox")} — ${needsYou} need you` : t("inbox")}
            className={cn(
              "relative inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              needsYou > 0 && "text-amber-600 dark:text-amber-400",
              className,
            )}
          >
            {needsYou > 0 ? <BellRingIcon className="size-4 animate-[wiggle_1.2s_ease-in-out_infinite]" /> : <InboxIcon className="size-4" />}
            <AnimatePresence>
              {needsYou > 0 ? (
                <motion.span
                  key="alert"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute top-0.5 right-0.5 flex size-2.5"
                >
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-amber-500 ring-2 ring-card" />
                </motion.span>
              ) : active > 0 ? (
                <motion.span
                  key="count"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sky-500 px-0.5 text-[8px] font-semibold text-white ring-1 ring-card"
                >
                  {active > 99 ? "99+" : active}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="top"
        align="end"
        onMouseEnter={enter}
        onMouseLeave={leave}
        className="w-84 gap-0 overflow-hidden rounded-xl border-border/60 bg-popover/95 p-0 text-popover-foreground shadow-xl backdrop-blur-md"
      >
        {onRunBackground && (
          <div className="border-b border-border/60 p-1.5">
            <button
              type="button"
              disabled={!canRunBackground}
              onClick={() => {
                setOpen(false);
                onRunBackground();
              }}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <PlayIcon className="size-3.5 fill-current" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("runInBackground")}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Runs in its own chat, with this one as context
                </span>
              </span>
              <Kbd className="shrink-0 text-[10px]">{MOD}↵</Kbd>
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            From this chat
          </span>
          {views.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {views.length}
            </span>
          )}
          {needsYou > 0 && (
            <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              {needsYou} need{needsYou === 1 ? "s" : ""} you
            </span>
          )}
        </div>

        {shown.length > 0 ? (
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5 scroll-hidden">
            {shown.map((view) => (
              <TaskRow
                key={view.task.id}
                view={view}
                onOpen={() => go(view.task.chatId ? `/chat/${view.task.chatId}` : "/inbox")}
              />
            ))}
            {hidden > 0 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">+{hidden} more in the Inbox</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-6 pt-3 pb-5 text-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <InboxIcon className="size-4" />
            </span>
            <p className="text-xs font-medium">No background tasks from this chat</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Press {MOD}↵ to hand a prompt off — you can keep chatting here while it works.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => go("/inbox")}
          className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <InboxIcon className="size-3.5" />
          {t("viewAllInbox")}
          <span className="ml-auto tabular-nums">{total}</span>
          <ArrowUpRightIcon className="size-3.5" />
        </button>
      </PopoverContent>
    </Popover>
  );
}

function TaskRow({ view, onOpen }: { view: TaskView; onOpen: () => void }) {
  const { task, status } = view;
  const attention = status === "needs-you";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${task.title}\n${STATUS_LABEL[status]} · ${task.modelName}\n\nClick to open this task's chat`}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent",
        attention && "bg-amber-500/10 hover:bg-amber-500/15",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {status === "running" ? (
          <LoaderIcon className="size-3.5 animate-spin text-sky-500" />
        ) : (
          <span className={cn("size-2 rounded-full", STATUS_DOT[status], attention && "animate-pulse")} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{task.title}</span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className={cn(attention && "font-medium text-amber-700 dark:text-amber-300")}>
            {STATUS_LABEL[status]}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate">{task.modelName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{ago(task.finishedAt ?? task.startedAt ?? task.createdAt)}</span>
        </span>
      </span>
      <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
