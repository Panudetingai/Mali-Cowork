/** Queue rules, kept pure so they can be tested without the app. */
import type { ChatRun, ChatSession } from "@/features/chat-history";
import { isWithin } from "@/features/workspace/folder-access";
import type { TaskRecord, TaskStatus } from "./types";

/** One folder inside the other counts: an agent in either can change the same files. */
export function foldersOverlap(a: string, b: string) {
  return isWithin(a, b) || isWithin(b, a);
}

/**
 * Folders something is working in right now: every Cowork run (the user's
 * own chats included) and every task already started.
 */
export function busyFolders(
  runs: Record<string, ChatRun>,
  chatOf: (id: string) => Pick<ChatSession, "mode" | "cwd" | "folders"> | undefined,
  tasks: TaskRecord[],
) {
  const busy: string[] = [];
  for (const chatId of Object.keys(runs)) {
    const chat = chatOf(chatId);
    if (chat?.mode !== "cowork") continue;
    if (chat.cwd) busy.push(chat.cwd);
    busy.push(...(chat.folders ?? []));
  }
  for (const task of tasks) if (task.phase === "running") busy.push(task.folder);
  return busy;
}

/**
 * Queued tasks that may start now, oldest first: within the concurrency cap,
 * and never two in overlapping folders. A task whose folder is busy waits
 * without holding up the ones behind it in other folders.
 */
export function nextToStart(tasks: TaskRecord[], busy: string[], maxConcurrent: number): TaskRecord[] {
  const running = tasks.filter((t) => t.phase === "running").length;
  const room = Math.max(0, maxConcurrent - running);
  const taken = [...busy];
  const picked: TaskRecord[] = [];
  const queued = tasks.filter((t) => t.phase === "queued").sort((a, b) => a.createdAt - b.createdAt);
  for (const task of queued) {
    if (picked.length >= room) break;
    if (taken.some((folder) => foldersOverlap(folder, task.folder))) continue;
    picked.push(task);
    taken.push(task.folder);
  }
  return picked;
}

/** What the Inbox card shows, from the stored phase and the live run. */
export function taskStatus(
  task: TaskRecord,
  run: Pick<ChatRun, "permissions" | "questions"> | undefined,
  chat: Pick<ChatSession, "messages"> | undefined,
): TaskStatus {
  switch (task.phase) {
    case "queued":
      return "queued";
    case "running":
      return run && (run.permissions.length > 0 || run.questions.length > 0) ? "needs-you" : "running";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "finished": {
      const turn = [...(chat?.messages ?? [])].reverse().find((m) => m.turn)?.turn;
      if (!turn) return "done";
      if (turn.state === "undone") return "undone";
      return task.accepted ? "accepted" : "ready";
    }
  }
}

/** Card order in the Inbox: what needs the user first. */
export const STATUS_ORDER: TaskStatus[] = [
  "needs-you",
  "ready",
  "running",
  "queued",
  "failed",
  "interrupted",
  "done",
  "accepted",
  "undone",
];
