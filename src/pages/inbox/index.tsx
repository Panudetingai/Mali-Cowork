"use client";

/**
 * Task Inbox (Epic B): every background Cowork task in one place — answer
 * what the agents ask, review what they changed, keep it or undo it.
 */
import { Button } from "@/components/ui/button";
import { useChatRuns } from "@/features/chat-history";
import { FilesChanged } from "@/features/checkpoints";
import { PermissionPrompt, QuestionPrompt } from "@/features/opencode";
import {
  acceptTask,
  useTaskViews,
  type TaskView as View,
  busyFolders,
  cancelTask,
  dismissTask,
  foldersOverlap,
  getMaxConcurrent,
  retryTask,
  setMaxConcurrent,
  type TaskRecord,
  type TaskStatus,
} from "@/features/tasks";
import { folderName } from "@/features/workspace";
import { cn } from "@/lib/utils";
import { allowFolderForRun, answerAgentQuestion, replyToPermission } from "@/pages/chat/turn";
import { EmptyState, SectionHeader, StatusPill } from "@/pages/settings/ui";
import {
  CheckIcon,
  FolderIcon,
  InboxIcon,
  LoaderIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const GROUPS: { title: string; statuses: TaskStatus[]; hint?: string }[] = [
  { title: "Needs you", statuses: ["needs-you"], hint: "The agent is waiting for your answer." },
  { title: "Ready to review", statuses: ["ready"], hint: "Check the changes, then keep or undo them." },
  { title: "In progress", statuses: ["running", "queued"] },
  { title: "Didn't finish", statuses: ["failed", "interrupted"] },
  { title: "Done", statuses: ["done", "accepted", "undone"] },
];

const PILL: Record<TaskStatus, { tone: "success" | "warning" | "danger" | "neutral" | "pending"; label: string }> = {
  "needs-you": { tone: "warning", label: "Needs you" },
  ready: { tone: "success", label: "Ready to review" },
  running: { tone: "pending", label: "Running" },
  queued: { tone: "neutral", label: "Queued" },
  failed: { tone: "danger", label: "Failed" },
  interrupted: { tone: "danger", label: "Interrupted" },
  done: { tone: "neutral", label: "Done" },
  accepted: { tone: "success", label: "Kept" },
  undone: { tone: "neutral", label: "Undone" },
};

export default function InboxPage() {
  const views = useTaskViews();
  const [max, setMax] = useState(getMaxConcurrent);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-6 overflow-y-auto px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Inbox"
        description="Cowork tasks running in the background. Start one with the Inbox button next to Send, or ⌘⏎, in any Cowork chat — then keep working while it runs."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Run up to
            <select
              value={max}
              onChange={(event) => {
                const next = Number(event.target.value);
                setMax(next);
                setMaxConcurrent(next);
              }}
              className="h-8 rounded-lg border border-border/70 bg-background px-2 text-sm text-foreground"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            at once
          </label>
        }
      />

      {views.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title="No background tasks yet"
          description="In a Cowork chat, type a task and press ⌘⏎ (or the Inbox button). It runs here while you do something else — two tasks never change the same folder at once."
        />
      ) : (
        GROUPS.map((group) => {
          const items = views.filter((v) => group.statuses.includes(v.status));
          if (items.length === 0) return null;
          return (
            <section key={group.title} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-medium">{group.title}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
                {group.hint && <span className="text-xs text-muted-foreground">· {group.hint}</span>}
              </div>
              {items.map((view) => (
                <TaskCard key={view.task.id} view={view} all={views} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function TaskCard({ view, all }: { view: View; all: View[] }) {
  const { task, status, chat } = view;
  const runs = useChatRuns();
  const run = task.chatId ? runs[task.chatId] : undefined;
  const chatId = task.chatId;
  const reply = [...(chat?.messages ?? [])].reverse().find((m) => m.role === "assistant" || m.role === "error");
  const turnMessage = [...(chat?.messages ?? [])].reverse().find((m) => m.turn);
  const lastStep = reply?.activities?.at(-1)?.title;
  const pill = PILL[status];

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4",
        status === "needs-you" && "border-amber-500/40",
      )}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={task.folder}>
              <FolderIcon className="size-3.5" />
              {folderName(task.folder)}
            </span>
            <span className="text-xs text-muted-foreground">· {task.modelName}</span>
            <span className="text-xs text-muted-foreground">· {timeLabel(task, status)}</span>
            {task.from && (
              <Link to={`/chat/${task.from.id}`} className="max-w-48 truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
                · from “{task.from.title}”
              </Link>
            )}
          </div>
          <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {chatId && chat && (
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <Link to={`/chat/${chatId}`}>
                <MessageSquareIcon className="size-3.5" />
                Open chat
              </Link>
            </Button>
          )}
          <CardActions view={view} />
        </div>
      </header>

      {status === "running" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" />
          <span className="truncate">{lastStep ?? "Starting…"}</span>
        </p>
      )}

      {status === "queued" && <p className="text-xs text-muted-foreground">{queueReason(task, all)}</p>}

      {status === "needs-you" && chatId && run && (
        <div className="flex flex-col gap-2">
          {run.permissions.length > 0 && (
            <PermissionPrompt
              requests={run.permissions}
              onReply={(request, value) => replyToPermission(chatId, request, value)}
              onAllowFolder={(request, folder) => allowFolderForRun(chatId, request, folder)}
            />
          )}
          {run.permissions.length === 0 && run.questions.length > 0 && (
            <QuestionPrompt
              requests={run.questions}
              onAnswer={(request, answers) => answerAgentQuestion(chatId, request, answers)}
            />
          )}
        </div>
      )}

      {(status === "ready" || status === "accepted" || status === "undone") && chatId && turnMessage?.turn && (
        <FilesChanged chatId={chatId} messageId={turnMessage.id} turn={turnMessage.turn} />
      )}

      {(status === "failed" || status === "interrupted") && (
        <p className="rounded-lg bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-400">
          {status === "interrupted"
            ? "Mali was closed while this task ran. Whatever it changed is kept in its chat, with Undo."
            : task.error ?? "The task stopped with an error."}
        </p>
      )}

      {status === "done" && reply?.content && (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{reply.content}</p>
      )}
    </article>
  );
}

function CardActions({ view }: { view: View }) {
  const { task, status } = view;
  const buttons: ReactNode[] = [];
  if (status === "ready") {
    buttons.push(
      <Button key="keep" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => acceptTask(task.id)}>
        <CheckIcon className="size-3.5" />
        Keep changes
      </Button>,
    );
  }
  if (status === "running" || status === "needs-you") {
    buttons.push(
      <Button key="stop" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void cancelTask(task.id)}>
        <SquareIcon className="size-3 fill-current" />
        Stop
      </Button>,
    );
  }
  if (status === "queued") {
    buttons.push(
      <Button key="cancel" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void cancelTask(task.id)}>
        <XIcon className="size-3.5" />
        Cancel
      </Button>,
    );
  }
  if (status === "failed" || status === "interrupted") {
    buttons.push(
      <Button key="retry" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => retryTask(task.id)}>
        <RotateCcwIcon className="size-3.5" />
        Run again
      </Button>,
    );
  }
  if (["failed", "interrupted", "done", "accepted", "undone"].includes(status)) {
    buttons.push(
      <Button
        key="dismiss"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={() => dismissTask(task.id)}
        aria-label="Remove from Inbox"
        title="Remove from Inbox (the chat stays)"
      >
        <XIcon />
      </Button>,
    );
  }
  return <>{buttons}</>;
}

function queueReason(task: TaskRecord, all: View[]) {
  const running = all.map((v) => v.task).filter((t) => t.phase === "running");
  const blocker = busyFolders({}, () => undefined, running).find((folder) => foldersOverlap(folder, task.folder));
  if (blocker) return `Waiting for the task in ${folderName(blocker)} to finish — two tasks never change the same folder at once.`;
  return "Waiting for a free slot, or for your chat in this folder to finish.";
}

function timeLabel(task: TaskRecord, status: TaskStatus) {
  const since = (at: number) => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
  };
  if (status === "queued") return `queued ${since(task.createdAt)}`;
  if (status === "running" || status === "needs-you") return `started ${since(task.startedAt ?? task.createdAt)}`;
  return `finished ${since(task.finishedAt ?? task.createdAt)}`;
}
