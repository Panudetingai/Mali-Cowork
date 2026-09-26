import { useChatRuns, useChatSessions, type ChatSession } from "@/features/chat-history";
import { useMemo } from "react";
import { STATUS_ORDER, taskStatus } from "./logic";
import { useTasks } from "./queue";
import type { TaskRecord, TaskStatus } from "./types";

export type TaskView = {
  task: TaskRecord;
  status: TaskStatus;
  chat?: ChatSession;
};

/** Tasks with the status each card shows, in Inbox order. */
export function useTaskViews(): TaskView[] {
  const tasks = useTasks();
  const runs = useChatRuns();
  const sessions = useChatSessions();
  return useMemo(() => {
    const chats = new Map(sessions.map((s) => [s.id, s]));
    return tasks
      .map((task) => {
        const chat = task.chatId ? chats.get(task.chatId) : undefined;
        const run = task.chatId ? runs[task.chatId] : undefined;
        return { task, chat, status: taskStatus(task, run, chat) };
      })
      .sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
          (b.task.finishedAt ?? b.task.createdAt) - (a.task.finishedAt ?? a.task.createdAt),
      );
  }, [tasks, runs, sessions]);
}

/** Sidebar badge: tasks waiting on the user. */
export function useInboxAttention() {
  return useTaskViews().filter((v) => v.status === "needs-you" || v.status === "ready").length;
}

/** Sidebar badge: every task still in the Inbox. */
export function useInboxCount() {
  return useTasks().length;
}

/** Pending permission/question requests across all running inbox tasks. */
export function useInboxPendingPermissions() {
  const views = useTaskViews();
  const runs = useChatRuns();
  return useMemo(() => {
    let permissions = 0;
    let questions = 0;
    for (const view of views) {
      if (view.status !== "needs-you" || !view.task.chatId) continue;
      const run = runs[view.task.chatId];
      permissions += run?.permissions.length ?? 0;
      questions += run?.questions.length ?? 0;
    }
    return { permissions, questions };
  }, [views, runs]);
}

/** Recent tasks for the sidebar dropdown, latest first. */
export function useRecentTaskViews(limit = 6) {
  const views = useTaskViews();
  return useMemo(
    () =>
      views
        .slice()
        .sort((a, b) => (b.task.createdAt - a.task.createdAt))
        .slice(0, limit),
    [views, limit],
  );
}


/** The tasks a chat started; `chatId` undefined means a new chat (tasks with no source chat). */
export function useChatTaskViews(chatId: string | undefined): TaskView[] {
  const views = useTaskViews();
  return useMemo(
    () => views.filter((v) => (chatId ? v.task.from?.id === chatId : !v.task.from)),
    [views, chatId],
  );
}

export type ChildRequest = { view: TaskView; chatId: string };

/**
 * What this chat's background tasks are waiting on, so the chat that started
 * them can answer without opening each one.
 */
export function useChildTaskRequests(chatId: string | undefined) {
  const views = useChatTaskViews(chatId);
  const runs = useChatRuns();
  return useMemo(() => {
    const waiting: (ChildRequest & { permissions: number; questions: number })[] = [];
    for (const view of views) {
      const id = view.task.chatId;
      if (view.status !== "needs-you" || !id) continue;
      const run = runs[id];
      const permissions = run?.permissions.length ?? 0;
      const questions = run?.questions.length ?? 0;
      if (permissions + questions > 0) waiting.push({ view, chatId: id, permissions, questions });
    }
    return waiting;
  }, [views, runs]);
}
