/**
 * The phone's view of the chats and runs, worked out from the main window's
 * stores. Pure, so it is tested without a window.
 *
 * A summary, not a mirror: the steps a run took and the files it changed,
 * and an answer's text only once it is written.
 */
import type { ChatRun, ChatSession } from "@/features/chat-history";
import { extractChatBlocks } from "@/features/chat-blocks";
import type { WorkMode } from "@/features/opencode";
import { parseUnifiedDiff } from "@/components/diff/parse-unified";
import type { PermissionRequest, QuestionRequest, TodoItem } from "@/pages/chat/api/chat";
import type { ActivityItem, ChatMessage } from "@/pages/chat/types";
import type {
  RemoteChat,
  RemoteFile,
  RemoteMessage,
  RemotePermission,
  RemoteQuestion,
  RemoteRun,
  RemoteSession,
  RemoteState,
  RemoteStep,
  RemoteTodo,
} from "./types";

/** Steps a running card shows. */
const RUN_STEPS = 5;
/** Steps a message keeps; the count says how many there were. */
const MESSAGE_STEPS = 40;
const SESSIONS = 25;
const MESSAGES = 30;
const FILES = 40;
const TODOS = 30;
const PREVIEW_CHARS = 140;
const ANSWER_CHARS = 6000;
const PROMPT_CHARS = 2000;
const STEP_CHARS = 160;
const COMMAND_CHARS = 600;

export function remoteState(
  chats: ChatSession[],
  runs: Record<string, ChatRun>,
  listed: (chat: ChatSession) => boolean,
): RemoteState {
  const byId = new Map(chats.map((c) => [c.id, c]));
  const running = Object.keys(runs)
    .map((id) => runOf(byId.get(id), runs[id], id))
    .filter((run): run is RemoteRun => !!run);
  const sessions = chats
    .filter((c) => (listed(c) || !!runs[c.id]) && c.messages.length > 0)
    .sort((a, b) => Number(!!runs[b.id]) - Number(!!runs[a.id]) || b.updatedAt - a.updatedAt)
    .slice(0, SESSIONS)
    .map((chat) => sessionOf(chat, runs[chat.id]));
  return { runs: running, sessions };
}

function runOf(chat: ChatSession | undefined, run: ChatRun, chatId: string): RemoteRun | undefined {
  if (!chat) return undefined;
  const reply = lastAssistant(chat);
  const activities = ownSteps(reply?.activities ?? []);
  return {
    chatId,
    title: chat.title,
    mode: modeOf(chat),
    startedAt: chat.messages.filter((m) => m.role === "user").at(-1)?.createdAt,
    steps: activities.slice(-RUN_STEPS).map(stepOf),
    stepCount: activities.length,
    todos: todosOf(reply?.todos),
    files: reply ? filesOf(reply) : [],
    permissions: run.permissions.map(permissionOf),
    questions: (run.questions ?? []).map(questionOf),
  };
}

function sessionOf(chat: ChatSession, run: ChatRun | undefined): RemoteSession {
  const reply = lastAssistant(chat);
  const asked = chat.messages.filter((m) => m.role === "user").at(-1);
  const last = chat.messages.at(-1);
  const answer = reply && !reply.isStreaming ? answerText(reply) : "";
  return {
    id: chat.id,
    title: chat.title,
    mode: modeOf(chat),
    folder: folderName(chat.cwd),
    model: asked?.resend?.modelName ?? reply?.modelId?.split("/").at(-1),
    preview: answer ? clip(answer.replace(/\s+/g, " "), PREVIEW_CHARS, true) : undefined,
    running: !!run,
    waiting: !!run && (run.permissions.length > 0 || (run.questions?.length ?? 0) > 0),
    failed: last?.role === "error",
    updatedAt: chat.updatedAt,
    rev: revOf(chat, run),
  };
}

/**
 * Cheap to work out on every change, and the same while only text streams
 * in: messages, steps, an answer settling, files, approvals.
 */
function revOf(chat: ChatSession, run: ChatRun | undefined) {
  const last = chat.messages.at(-1);
  return [
    chat.messages.length,
    last?.activities?.length ?? 0,
    last?.activities?.filter((a) => a.done).length ?? 0,
    last?.todos?.filter((t) => isDone(t)).length ?? 0,
    last?.isStreaming ? "w" : last?.content.length ?? 0,
    last?.turn?.changes.length ?? 0,
    run?.permissions.map((p) => p.id).join(",") ?? "",
    run?.questions?.map((q) => q.id).join(",") ?? "",
  ].join(":");
}

/** One chat, summed up message by message, for the phone's chat view. */
export function remoteChat(chat: ChatSession, run: ChatRun | undefined): RemoteChat {
  const lastUser = chat.messages.filter((m) => m.role === "user" && m.resend).at(-1);
  return {
    id: chat.id,
    title: chat.title,
    mode: modeOf(chat),
    folder: folderName(chat.cwd),
    modelId: lastUser?.resend?.modelId,
    running: !!run,
    messages: chat.messages.slice(-MESSAGES).map(messageOf),
    permissions: run?.permissions.map(permissionOf) ?? [],
    questions: run?.questions?.map(questionOf) ?? [],
  };
}

function messageOf(message: ChatMessage): RemoteMessage {
  const base = { id: message.id, role: message.role, at: message.createdAt };
  if (message.role === "user") {
    const text = message.content.trim();
    return { ...base, text: clip(text, PROMPT_CHARS), clipped: text.length > PROMPT_CHARS || undefined };
  }
  if (message.role === "error") return { ...base, text: clip(message.content.trim(), PROMPT_CHARS) };
  const activities = ownSteps(message.activities ?? []);
  const writing = !!message.isStreaming;
  const text = writing ? "" : answerText(message);
  const files = filesOf(message);
  const todos = todosOf(message.todos);
  return {
    ...base,
    text: clip(text, ANSWER_CHARS),
    clipped: text.length > ANSWER_CHARS || undefined,
    writing: writing || undefined,
    steps: activities.length ? activities.slice(-MESSAGE_STEPS).map(stepOf) : undefined,
    stepCount: activities.length || undefined,
    files: files.length ? files : undefined,
    todos: todos.length ? todos : undefined,
    model: message.modelId?.split("/").at(-1),
    durationMs: message.durationMs,
  };
}

function answerText(message: ChatMessage) {
  return extractChatBlocks(message.content ?? "").text.trim();
}

function lastAssistant(chat: ChatSession) {
  return chat.messages.filter((m) => m.role === "assistant").at(-1);
}

function modeOf(chat: ChatSession): WorkMode {
  return chat.mode ?? (chat.cwd ? "cowork" : "chat");
}

function folderName(cwd: string | undefined) {
  return cwd ? cwd.split(/[\\/]/).filter(Boolean).at(-1) : undefined;
}

/** The lead's own steps; a team bot's show inside its hand-off. */
function ownSteps(activities: ActivityItem[]) {
  return activities.filter((a) => !a.id?.startsWith("team:"));
}

function stepOf(activity: ActivityItem): RemoteStep {
  return { title: clip(activity.title.replace(/\s+/g, " ").trim(), STEP_CHARS), kind: activity.kind, done: activity.done };
}

function isDone(todo: TodoItem) {
  return !!todo.done || todo.status === "completed";
}

function todosOf(todos: TodoItem[] | undefined): RemoteTodo[] {
  return (todos ?? []).slice(0, TODOS).map((t) => ({
    text: clip(t.text, STEP_CHARS),
    done: isDone(t),
    active: t.status === "in_progress",
  }));
}

function permissionOf(request: PermissionRequest): RemotePermission {
  const command = request.patterns.filter((p) => p && p !== "*").join("\n") || request.detail || "";
  return { id: request.id, title: request.title, command: clip(command, COMMAND_CHARS) };
}

function questionOf(request: QuestionRequest): RemoteQuestion {
  return { id: request.id, questions: request.questions };
}

/**
 * The files a reply changed: what the checkpoint found once the turn ended
 * (exact, and covers commands that wrote files), or else what its edit steps
 * reported so far.
 */
export function filesOf(message: ChatMessage): RemoteFile[] {
  if (message.turn?.changes.length) {
    return message.turn.changes.slice(0, FILES).map((c) => ({
      path: c.relative || c.path,
      kind: c.kind,
      additions: c.additions,
      deletions: c.deletions,
    }));
  }
  const files = new Map<string, RemoteFile>();
  for (const activity of ownSteps(message.activities ?? [])) {
    for (const file of stepFiles(activity)) {
      const seen = files.get(file.path);
      files.set(
        file.path,
        seen
          ? {
              ...seen,
              kind: seen.kind === "added" ? "added" : file.kind,
              additions: (seen.additions ?? 0) + (file.additions ?? 0),
              deletions: (seen.deletions ?? 0) + (file.deletions ?? 0),
            }
          : file,
      );
    }
  }
  return [...files.values()].slice(0, FILES);
}

const WRITES = /^(write|edit|patch|update|create|overwrite|replace|multiedit|apply)/i;
const NEW_FILE = /^(write|create|overwrite)/i;

/** A step keeps its object while later steps arrive: its diff is parsed once. */
const parsed = new WeakMap<ActivityItem, RemoteFile[]>();

function stepFiles(step: ActivityItem): RemoteFile[] {
  const cached = parsed.get(step);
  if (cached) return cached;
  const files = readStep(step);
  // A step still running may grow; parse it again next time.
  if (step.done) parsed.set(step, files);
  return files;
}

function readStep(step: ActivityItem): RemoteFile[] {
  const [verb = "", ...rest] = step.title.trim().split(/\s+/);
  if (!WRITES.test(verb)) return [];
  const diffs = step.detail ? parseUnifiedDiff(step.detail) : [];
  if (diffs.length) {
    return diffs.map((file) => ({
      path: file.path,
      kind: file.created ? "added" : file.deleted ? "deleted" : "modified",
      additions: file.diff.additions,
      deletions: file.diff.deletions,
    }));
  }
  // Without a diff only a write names its file: "Update todos" is no file.
  const path = rest.join(" ");
  if (!path || !NEW_FILE.test(verb)) return [];
  return [{ path, kind: "added" }];
}

function clip(text: string, max: number, end = false) {
  if (text.length <= max) return text;
  return end ? `…${text.slice(-(max - 1))}` : `${text.slice(0, max - 1)}…`;
}
