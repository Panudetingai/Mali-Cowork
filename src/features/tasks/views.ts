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

