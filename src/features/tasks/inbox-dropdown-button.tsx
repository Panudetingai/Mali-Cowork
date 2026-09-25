"use client";

import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { InboxIcon, LoaderIcon, PlayIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInboxCount, useInboxPendingPermissions, useRecentTaskViews } from "./views";

const STATUS_DOT: Record<string, string> = {
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

const STATUS_LABEL: Record<string, string> = {
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

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

interface InboxDropdownButtonProps {
  onRunBackground?: () => void;
  canRunBackground?: boolean;
  className?: string;
  title?: string;
}

export function InboxDropdownButton({
  onRunBackground,
  canRunBackground,
  className,
  title,
}: InboxDropdownButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const count = useInboxCount();
  const { permissions } = useInboxPendingPermissions();
  const recent = useRecentTaskViews(6);
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

  const runAndClose = () => {
    setOpen(false);
    onRunBackground?.();
  };

  const itemClass =
    "flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-none select-none transition-colors hover:bg-accent hover:text-accent-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div onMouseEnter={enter} onMouseLeave={leave}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={title ?? t("runInBackground")}
            className={cn(
              "relative inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground",
              className,
            )}
          >
            <InboxIcon className="size-4" />
            {permissions > 0 && (
              <span className="absolute top-1 right-1 size-2 rounded-full bg-red-500 ring-1 ring-card" />
            )}
            {count > 0 && permissions === 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center gap-2 rounded-full bg-amber-500 px-0.5 text-[8px] font-semibold text-white ring-1 ring-card">
                {count > 99 ? "∞" : count}
              </span>
            )}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="top"
        align="end"
        // sideOffset={4}
        onMouseEnter={enter}
        onMouseLeave={leave}
        className="w-80 gap-2 rounded-xl border-border/60 bg-popover/95 p-1.5 backdrop-blur-md text-popover-foreground shadow-xl"
      >
        {onRunBackground && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!canRunBackground}
              onClick={runAndClose}
              className={cn(itemClass, "font-medium", !canRunBackground && "opacity-50")}
            >
              <PlayIcon className="size-3.5 shrink-0" />
              {t("runInBackground")}
            </Button>
            <div className="h-px bg-border" />
          </>
        )}

        <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("inbox")} · {count} {count === 1 ? t("item") : t("items")}
          {permissions > 0 && (
            <span className="ml-1.5 text-amber-500">({permissions} pending approval)</span>
          )}
        </div>
        <div className="h-px bg-border" />

        {recent.length > 0 ? (
          <>
            {recent.map(({ task, status }) => {
              const dot = STATUS_DOT[status] ?? "bg-muted-foreground";
              const label = STATUS_LABEL[status] ?? status;
              const target = task.chatId ? `/chat/${task.chatId}` : "/inbox";
              return (
                <Button
                  key={task.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    navigate(target);
                  }}
                  className={itemClass}
                >
                  {status === "running" ? (
                    <LoaderIcon className="size-3 shrink-0 animate-spin text-sky-500" />
                  ) : (
                    <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left" title={task.title}>
                    {truncate(task.title, 48)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
                </Button>
              );
            })}
            <div className="my-1 h-px bg-border" />
          </>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate("/inbox");
          }}
          className={cn(itemClass, "font-medium")}
        >
          <InboxIcon className="size-3.5" />
          {t("viewAllInbox")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
