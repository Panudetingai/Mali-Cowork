/**
 * The Task Inbox queue: background Cowork tasks, started oldest first within
 * a concurrency cap, one per folder at a time. Each task runs in its own chat
 * through the same send pipeline as the chat page (`sendTurn`), so it keeps
 * its checkpoint, Files changed and Undo.
 */
import { createChat, getChat, getRuns, subscribeToRuns } from "@/features/chat-history";
import { notifyPermissionPending, notifyTaskDone } from "@/features/notifications/notify";
import { createStore } from "@/lib/local-store";
import { replyToPermission, sendTurn, stopRun, type TurnInput } from "@/pages/chat/turn";
import { busyFolders, nextToStart } from "./logic";
import type { TaskRecord } from "./types";

/** Finished tasks beyond this are dropped from the Inbox (their chats stay). */
const KEEP = 200;
/**
 * Tasks run side by side, each its own agent run (a CLI agent is a process
 * of its own, with its connectors). On a slower machine 1–2 keeps the app
 * responsive; the Inbox lets the user pick 1–5.
 */
const DEFAULT_MAX = 3;
const MAX_KEY = "mali.tasks.maxConcurrent";

const store = createStore<TaskRecord[]>([], {
  key: "mali.tasks.v1",
  revive: (saved) => (Array.isArray(saved) ? saved : []),
});

export const useTasks = store.use;
export const getTasks = store.get;
/** Any task changed (the notch follows the one it started). */
export const subscribeToTasks = store.subscribe;

function patch(id: string, fn: (task: TaskRecord) => TaskRecord) {
  store.set((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
}

export function getMaxConcurrent() {
  try {
    const n = Number(localStorage.getItem(MAX_KEY));
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : DEFAULT_MAX;
  } catch {
    return DEFAULT_MAX;
  }
}

export function setMaxConcurrent(n: number) {
  try {
    localStorage.setItem(MAX_KEY, String(Math.min(5, Math.max(1, Math.round(n)))));
  } catch {
    // Lasts for this session only.
  }
  pumpTasks();
}

export type NewTask = {
  input: TurnInput;
  /** The Cowork folder; must already be granted (the composer asks first). */
  folder: string;
  projectId?: string;
  from?: { id: string; title: string };
};

/** Add a task; it starts right away when a slot and its folder are free. */
export function enqueueTask({ input, folder, projectId, from }: NewTask): TaskRecord {
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    title: input.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "Background task",
    folder,
    projectId,
    from,
    modelId: input.resend.modelId,
    modelName: input.resend.modelName,
    createdAt: Date.now(),
    phase: "queued",
    input,
  };
  store.set((prev) => [task, ...prev].slice(0, KEEP));
  pumpTasks();
  return task;
}

/** Start whatever may start now. Safe to call any time. */
export function pumpTasks() {
  const tasks = store.get();
  const busy = busyFolders(getRuns(), getChat, tasks);
  for (const task of nextToStart(tasks, busy, getMaxConcurrent())) void start(task);
}

async function start(task: TaskRecord) {
  const chat = createChat(task.input.prompt, {
    mode: "cowork",
    cwd: task.folder,
    projectId: task.projectId,
    taskFrom: task.from,
    inboxTask: true,
  });
  // Marked running before anything awaits, so the next pump sees the folder taken.
  patch(task.id, (t) => ({ ...t, phase: "running", chatId: chat.id, startedAt: Date.now() }));

  let sent = false;
  let thrown: string | undefined;
  try {
    sent = await sendTurn({ chatId: chat.id, newChatMode: "cowork", newChatProjectId: task.projectId }, task.input);
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }

  const last = getChat(chat.id)?.messages.at(-1);
  const error =
    thrown ??
    (!sent ? "Mali couldn't use the folder — access was declined or removed." : undefined) ??
    (last?.role === "error" ? last.content : undefined);
  patch(task.id, (t) => ({ ...t, phase: error ? "failed" : "finished", finishedAt: Date.now(), error }));
  if (!error) void notifyTaskDone(task.title);
  pumpTasks();
}

/** A queued task is dropped; a running one is stopped (its chat keeps what it did). */
export async function cancelTask(id: string) {
  const task = store.get().find((t) => t.id === id);
  if (!task) return;
  if (task.phase === "queued") {
    store.set((prev) => prev.filter((t) => t.id !== id));
    return;
  }
  if (task.phase === "running" && task.chatId) await stopRun(task.chatId);
}

/** The user reviewed the changes and keeps them. */
export function acceptTask(id: string) {
  patch(id, (t) => ({ ...t, accepted: true }));
}

/** Run a failed or interrupted task again, in a fresh chat. */
export function retryTask(id: string) {
  const task = store.get().find((t) => t.id === id);
  if (!task) return;
  store.set((prev) => prev.filter((t) => t.id !== id));
  enqueueTask({ input: task.input, folder: task.folder, projectId: task.projectId, from: task.from });
}

/** Take a finished task off the Inbox; its chat stays in history. */
export function dismissTask(id: string) {
  store.set((prev) => prev.filter((t) => t.id !== id));
}

/** Never reset: React StrictMode (and hot reload) run the startup effect twice. */
let recovered = false;

/**
 * Main window, at startup. A task that was running when the app closed can't
 * finish (its agent is gone): it's marked interrupted, and its chat keeps
 * whatever it did, with Undo. Only a task whose chat has no run going counts,
 * so running this again never interrupts live work. Queued tasks simply start.
 */
export function startTaskQueue() {
  if (!recovered) {
    recovered = true;
    const runs = getRuns();
    store.set((prev) =>
      prev.map((t) =>
        t.phase === "running" && !(t.chatId && runs[t.chatId])
          ? { ...t, phase: "interrupted", finishedAt: Date.now() }
          : t,
      ),
    );
  }
  pumpTasks();

  // A background task waiting on the user gets a notification (with the
  // approval buttons on macOS), unless its chat is the one on screen — the
  // chat page already notifies for that one.
  const seen = new Map<string, number>();
  const unsubscribe = subscribeToRuns(() => {
    const runs = getRuns();
    for (const task of store.get()) {
      if (task.phase !== "running" || !task.chatId) continue;
      const chatId = task.chatId;
      const waiting = runs[chatId]?.permissions ?? [];
      const before = seen.get(chatId) ?? 0;
      seen.set(chatId, waiting.length);
      if (waiting.length <= before) continue;
      if (window.location.pathname === `/chat/${chatId}`) continue;
      void notifyPermissionPending(waiting, (request, reply) => {
        void replyToPermission(chatId, request, reply).catch((e) => console.warn("[tasks] reply failed", e));
      });
    }
    // A run that ended in a user's chat may free a folder a task waits for.
    pumpTasks();
  });
  return () => {
    unsubscribe();
  };
}
