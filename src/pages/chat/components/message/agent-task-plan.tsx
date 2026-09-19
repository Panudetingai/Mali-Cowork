"use client";

import { cn } from "@/lib/utils";
import type { TodoItem } from "@/pages/chat/api/chat";
import { CheckIcon, CircleIcon, LoaderIcon } from "lucide-react";
import { useMemo, useState } from "react";

const MAX_VISIBLE = 6;

function statusIcon(item: TodoItem) {
  if (item.done || item.status === "completed" || item.status === "done") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (item.status === "in_progress" || item.status === "inProgress") {
    return <LoaderIcon className="size-4 shrink-0 animate-spin text-amber-500" />;
  }
  return <CircleIcon className="size-4 shrink-0 text-muted-foreground/50" />;
}

export function AgentTaskPlan({ todos }: { todos: TodoItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!todos.length) return null;

  const doneCount = useMemo(
    () => todos.filter((t) => t.done || t.status === "completed" || t.status === "done").length,
    [todos],
  );
  const progress = Math.round((doneCount / todos.length) * 100);
  const visible = expanded ? todos : todos.slice(0, MAX_VISIBLE);
  const hasMore = todos.length > MAX_VISIBLE;

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-border/70 bg-muted/30">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium">Task plan</span>
          <span className="rounded-full bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {doneCount}/{todos.length}
          </span>
        </div>
        <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <ul className="flex flex-col gap-1 px-3.5 pb-3">
        {visible.map((item, index) => (
          <li key={item.id ?? `todo-${index}`} className="flex items-start gap-2 text-sm">
            {statusIcon(item)}
            <span
              className={cn(
                "min-w-0 leading-snug",
                (item.done || item.status === "completed" || item.status === "done") &&
                  "text-muted-foreground line-through decoration-muted-foreground/50",
              )}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-border/60 py-1.5 text-center text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          {expanded ? "Show less" : `Show ${todos.length - MAX_VISIBLE} more`}
        </button>
      )}
    </div>
  );
}
