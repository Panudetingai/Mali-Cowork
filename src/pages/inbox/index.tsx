"use client";

/**
 * Task Inbox (Epic B): every background Cowork task in one place — answer
 * what the agents ask, review what they changed, keep it or undo it.
 */
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { allowFolderForRun, answerAgentQuestion, replyToPermission } from "@/pages/chat/turn";
import { EmptyState, StatusPill } from "@/pages/settings/ui";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  ClockIcon,
  FolderIcon,
  HandIcon,
  InboxIcon,
  LoaderIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SquareIcon,
  Undo2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

type Tone = "success" | "warning" | "danger" | "neutral" | "pending";

/** What each status is called and how it looks, in words a user would use. */
const STATUS: Record<TaskStatus, { tone: Tone; label: string; icon: LucideIcon; iconClass: string }> = {
  "needs-you": { tone: "warning", label: "Needs your answer", icon: HandIcon, iconClass: "text-amber-600 dark:text-amber-400" },
  ready: { tone: "success", label: "Ready to review", icon: CheckCircle2Icon, iconClass: "text-emerald-600 dark:text-emerald-400" },
  running: { tone: "pending", label: "Running", icon: LoaderIcon, iconClass: "animate-spin text-sky-600 dark:text-sky-400" },
  queued: { tone: "neutral", label: "Waiting", icon: ClockIcon, iconClass: "text-muted-foreground" },
  failed: { tone: "danger", label: "Failed", icon: AlertCircleIcon, iconClass: "text-red-600 dark:text-red-400" },
  interrupted: { tone: "danger", label: "Interrupted", icon: AlertCircleIcon, iconClass: "text-red-600 dark:text-red-400" },
  done: { tone: "neutral", label: "Finished", icon: CheckIcon, iconClass: "text-muted-foreground" },
  accepted: { tone: "success", label: "Changes kept", icon: CheckIcon, iconClass: "text-muted-foreground" },
  undone: { tone: "neutral", label: "Changes undone", icon: Undo2Icon, iconClass: "text-muted-foreground" },
};

type GroupId = "needs-you" | "review" | "active" | "failed" | "finished";

const GROUPS: { id: GroupId; title: string; statuses: TaskStatus[]; hint?: string }[] = [
  { id: "needs-you", title: "Needs you", statuses: ["needs-you"], hint: "The agent is paused until you answer." },
  { id: "review", title: "Ready to review", statuses: ["ready"], hint: "Look over the changes, then keep or undo them." },
  { id: "active", title: "In progress", statuses: ["running", "queued"] },
  { id: "failed", title: "Didn't finish", statuses: ["failed", "interrupted"] },
  { id: "finished", title: "Finished", statuses: ["done", "accepted", "undone"], hint: "Removing a task keeps its chat." },
];

/** Groups a filter shows; "all" is every group. */
const FILTERS: { id: "all" | GroupId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "review", label: "To review" },
  { id: "active", label: "In progress" },
  { id: "failed", label: "Didn't finish" },
  { id: "finished", label: "Finished" },
];

const FINISHED: TaskStatus[] = ["failed", "interrupted", "done", "accepted", "undone"];

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const SEND_TO_INBOX = isMac ? "⌘⏎" : "Ctrl+Enter";

export default function InboxPage() {
  const views = useTaskViews();
  const [filter, setFilter] = useState<"all" | GroupId>("all");
  const counts = Object.fromEntries(
    GROUPS.map((g) => [g.id, views.filter((v) => g.statuses.includes(v.status)).length]),
  ) as Record<GroupId, number>;
  // A filter whose tasks are all gone falls back to everything.
  const active = filter !== "all" && counts[filter] === 0 ? "all" : filter;
  const groups = GROUPS.filter((g) => active === "all" || g.id === active);

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Cowork tasks that run in the background while you keep working. To send one here, type it in a Cowork
                chat and press <Kbd>{SEND_TO_INBOX}</Kbd>.
              </p>
            </div>
            <ConcurrencyPicker />
          </header>

          {views.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title="No background tasks yet"
              description={`In a Cowork chat, type a task and press ${SEND_TO_INBOX} (or the Inbox button next to Send). It runs here while you do something else — two tasks never change the same folder at once.`}
            />
          ) : (
            <>
              <nav aria-label="Filter tasks" className="-mx-1 flex flex-wrap gap-1">
                {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => {
                  const count = f.id === "all" ? views.length : counts[f.id];
                  const selected = active === f.id;
                  const urgent = f.id === "needs-you" || f.id === "review";
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      aria-pressed={selected}
                      className={cn(
                        "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        selected ? "text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {selected && (
                        <motion.span
                          layoutId="inbox-filter"
                          className="absolute inset-0 rounded-full bg-foreground"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span className="relative">{f.label}</span>
                      <span
                        className={cn(
                          "relative rounded-full px-1.5 text-[10px] tabular-nums",
                          selected
                            ? "bg-background/20"
                            : urgent
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "bg-muted",
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </nav>

              <AnimatePresence mode="popLayout" initial={false}>
                {groups.map((group) => {
                  const items = views.filter((v) => group.statuses.includes(v.status));
                  if (items.length === 0) return null;
                  return (
                    <motion.section
                      key={group.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, ease: MALI_EASE }}
                      className="flex flex-col gap-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">{group.title}</h3>
                        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
                        {group.hint && (
                          <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {group.hint}</span>
                        )}
                        {group.id === "finished" || group.id === "failed" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-7 text-xs text-muted-foreground"
                            onClick={() => items.forEach((v) => dismissTask(v.task.id))}
                          >
                            Clear all
                          </Button>
                        ) : null}
                      </div>
                      <AnimatePresence mode="popLayout" initial={false}>
                        {items.map((view) => (
                          <TaskCard key={view.task.id} view={view} all={views} />
                        ))}
                      </AnimatePresence>
                    </motion.section>
                  );
                })}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-sans text-xs font-medium text-foreground">{children}</kbd>
  );
}

/** How many tasks may run side by side; one per folder regardless. */
function ConcurrencyPicker() {
  const [max, setMax] = useState(getMaxConcurrent);
  return (
    <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
      <span className="text-xs text-muted-foreground" id="inbox-concurrency">
        Tasks running at once
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={String(max)}
        aria-labelledby="inbox-concurrency"
        onValueChange={(value) => {
          if (!value) return;
          const next = Number(value);
          setMax(next);
          setMaxConcurrent(next);
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <ToggleGroupItem key={n} value={String(n)} className="w-8 text-xs tabular-nums">
            {n}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * The reply as plain text: previews show a sentence or two, and Markdown
 * marks (backticks, link targets, emphasis) only get in the way there.
 */
function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, "$2")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\s+/g, " ")
    .trim();
}

function TaskCard({ view, all }: { view: View; all: View[] }) {
  const { task, status, chat } = view;
  const runs = useChatRuns();
  const run = task.chatId ? runs[task.chatId] : undefined;
  const chatId = task.chatId;
  const reply = [...(chat?.messages ?? [])].reverse().find((m) => m.role === "assistant" || m.role === "error");
  const turnMessage = [...(chat?.messages ?? [])].reverse().find((m) => m.turn);
  const lastStep = reply?.activities?.at(-1)?.title;
  const look = STATUS[status];
  const Icon = look.icon;
  const finished = FINISHED.includes(status);
  const preview = reply?.content ? plainText(reply.content) : "";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ duration: 0.3, ease: MALI_EASE }}
      className={cn(
        "group/task flex flex-col gap-3 rounded-2xl bg-muted/40 p-4 transition-colors hover:bg-muted/60",
        status === "needs-you" && "bg-amber-500/[0.06] ring-1 ring-amber-500/35 hover:bg-amber-500/10",
        status === "ready" && "ring-1 ring-emerald-500/25",
      )}
    >
      <header className="flex items-start gap-3">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" title={look.label}>
          <Icon className={cn("size-4", look.iconClass)} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="min-w-0 truncate text-sm font-medium" title={task.title}>
              {task.title}
            </h4>
            <StatusPill tone={look.tone} className="shrink-0">
              {look.label}
            </StatusPill>
          </div>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1" title={task.folder}>
              <FolderIcon className="size-3" />
              {folderName(task.folder)}
            </span>
            <Dot />
            <span>{task.modelName}</span>
            <Dot />
            <span>{timeLabel(task, status)}</span>
            {task.from && (
              <>
                <Dot />
                <Link
                  to={`/chat/${task.from.id}`}
                  className="max-w-56 truncate hover:text-foreground hover:underline"
                  title={`Started from “${task.from.title}”`}
                >
                  from “{task.from.title}”
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PrimaryAction view={view} />
          {chatId && chat && (
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <Link to={`/chat/${chatId}`}>
                <MessageSquareIcon className="size-3.5" />
                <span className="hidden sm:inline">Open chat</span>
              </Link>
            </Button>
          )}
          {finished && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground opacity-60 transition-opacity group-hover/task:opacity-100 focus-visible:opacity-100"
              onClick={() => dismissTask(task.id)}
              aria-label="Remove from Inbox"
              title="Remove from Inbox — the chat stays"
            >
              <XIcon />
            </Button>
          )}
        </div>
      </header>

      {/* Everything below lines up with the title, not the icon. */}
      <div className="flex flex-col gap-2 pl-8 empty:hidden">
        {status === "running" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CircleDashedIcon className="size-3.5 shrink-0 animate-spin [animation-duration:3s]" />
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

        {/* Waiting on a decision: the changes are the point, so they show in full. */}
        {status === "ready" && chatId && turnMessage?.turn && (
          <FilesChanged chatId={chatId} messageId={turnMessage.id} turn={turnMessage.turn} />
        )}

        {/* Already decided: a one-line summary, the list on demand. */}
        {(status === "accepted" || status === "undone") && chatId && turnMessage?.turn && (
          <Collapsible summary={changeSummary(turnMessage.turn.changes)}>
            <FilesChanged chatId={chatId} messageId={turnMessage.id} turn={turnMessage.turn} />
          </Collapsible>
        )}

        {(status === "failed" || status === "interrupted") && (
          <p className="rounded-lg bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-400">
            {status === "interrupted"
              ? "Mali was closed while this task ran. Whatever it changed is kept in its chat, with Undo."
              : task.error ?? "The task stopped with an error."}
          </p>
        )}

        {status === "done" && preview && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={preview}>
            <span className="font-medium text-foreground/70">Reply: </span>
            {preview}
          </p>
        )}
      </div>
    </motion.article>
  );
}

function Dot() {
  return <span aria-hidden className="text-muted-foreground/50">·</span>;
}

function changeSummary(changes: { additions?: number | null; deletions?: number | null }[]) {
  const added = changes.reduce((sum, c) => sum + (c.additions ?? 0), 0);
  const removed = changes.reduce((sum, c) => sum + (c.deletions ?? 0), 0);
  return (
    <>
      {changes.length} {changes.length === 1 ? "file" : "files"} changed
      <span className="ml-1.5 tabular-nums text-emerald-600 dark:text-emerald-400">+{added}</span>
      <span className="ml-1 tabular-nums text-red-600 dark:text-red-400">−{removed}</span>
    </>
  );
}

function Collapsible({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {summary}
        <ChevronDownIcon className={cn("ml-1 size-3.5 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: MALI_EASE }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The one thing to do next on this card, if any. */
function PrimaryAction({ view }: { view: View }) {
  const { task, status } = view;
  if (status === "ready") {
    return (
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => acceptTask(task.id)}>
        <CheckIcon className="size-3.5" />
        Keep changes
      </Button>
    );
  }
  if (status === "running" || status === "needs-you") {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void cancelTask(task.id)}>
        <SquareIcon className="size-3 fill-current" />
        Stop
      </Button>
    );
  }
  if (status === "queued") {
    return (
      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void cancelTask(task.id)}>
        <XIcon className="size-3.5" />
        Cancel
      </Button>
    );
  }
  if (status === "failed" || status === "interrupted") {
    return (
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => retryTask(task.id)}>
        <RotateCcwIcon className="size-3.5" />
        Run again
      </Button>
    );
  }
  return null;
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
