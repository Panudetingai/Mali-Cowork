/**
 * Above the composer: the background tasks started from this chat. Their
 * own chats stay out of the sidebar (they live in the Inbox), so this is
 * where the chat that asked for them shows how they're doing.
 */
import { cn } from "@/lib/utils";
import { InboxIcon, LoaderIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { TaskStatus } from "./types";
import { useTaskViews } from "./views";

const HINT_KEY = "mali.tasks.hintSeen";
/** Finished tasks drop off the strip; the Inbox keeps them. */
const SHOWN: TaskStatus[] = ["needs-you", "ready", "running", "queued", "failed", "interrupted"];
const MAX_CHIPS = 3;

const LABEL: Partial<Record<TaskStatus, string>> = {
  "needs-you": "needs you",
  ready: "ready to review",
  running: "running",
  queued: "queued",
  failed: "failed",
  interrupted: "interrupted",
};

const DOT: Partial<Record<TaskStatus, string>> = {
  "needs-you": "bg-amber-500",
  ready: "bg-emerald-500",
  queued: "bg-muted-foreground/50",
  failed: "bg-red-500",
  interrupted: "bg-red-500",
};

function hintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

/** `chatId` undefined: a new chat, so tasks started without a source chat. */
export function ChatTasksStrip({ chatId }: { chatId?: string }) {
  const views = useTaskViews().filter(
    (v) => SHOWN.includes(v.status) && (chatId ? v.task.from?.id === chatId : !v.task.from),
  );
  const [showHint, setShowHint] = useState(() => !hintSeen());
  if (views.length === 0) return null;

  const dismissHint = () => {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      // Shows again next time; harmless.
    }
  };

  const shown = views.slice(0, MAX_CHIPS);
  const more = views.length - shown.length;

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {showHint && (
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <InboxIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1 leading-relaxed">
            Background tasks run in the <span className="font-medium text-foreground">Inbox</span>, each in its own chat
            with this conversation as context — keep chatting here. You'll get a notification when one needs you or
            finishes.
          </span>
          <button type="button" onClick={dismissHint} className="rounded p-0.5 hover:bg-muted" aria-label="Got it">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      <div className="scroll-hidden flex items-center gap-1.5 overflow-x-auto">
        {shown.map(({ task, status }) => (
          <Link
            key={task.id}
            to={task.chatId ? `/chat/${task.chatId}` : "/inbox"}
            title={`${task.title} — ${LABEL[status]}`}
            className={cn(
              "flex max-w-64 shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-muted/60",
              status === "needs-you" ? "border-amber-500/50" : "border-border/70",
            )}
          >
            {status === "running" ? (
              <LoaderIcon className="size-3 shrink-0 animate-spin text-sky-500" />
            ) : (
              <span className={cn("size-1.5 shrink-0 rounded-full", DOT[status])} />
            )}
            <span className="truncate">{task.title}</span>
            <span className="shrink-0 text-muted-foreground">· {LABEL[status]}</span>
          </Link>
        ))}
        <Link
          to="/inbox"
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <InboxIcon className="size-3.5" />
          {more > 0 ? `+${more} in Inbox` : "Inbox"}
        </Link>
      </div>
    </div>
  );
}

/** Inside a task's own chat: where it came from, since it isn't in the sidebar. */
export function TaskChatNote({ from }: { from?: { id: string; title: string } }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <InboxIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        Background task
        {from && (
          <>
            {" "}from{" "}
            <Link to={`/chat/${from.id}`} className="text-foreground hover:underline">
              “{from.title}”
            </Link>
          </>
        )}
      </span>
      <Link to="/inbox" className="ml-auto shrink-0 hover:text-foreground">
        Inbox
      </Link>
    </div>
  );
}
