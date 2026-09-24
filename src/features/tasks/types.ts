/**
 * Epic B (docs/PRD-delight-v0.3.md §6.3): Cowork tasks that run in the
 * background, queued so two never change the same folder at once.
 */
import type { TurnInput } from "@/pages/chat/turn";

/** What the queue stores. Live states (running, needs you) come from the run store. */
export type TaskRecord = {
  id: string;
  /** Set when the task starts: the chat it runs in. */
  chatId?: string;
  title: string;
  /** The folder the agent works in; one writing task per folder at a time. */
  folder: string;
  projectId?: string;
  /** The chat the task was started from; its conversation travels in `input.context`. */
  from?: { id: string; title: string };
  modelId: string;
  modelName: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Stored lifecycle; see `TaskStatus` for what the Inbox shows. */
  phase: "queued" | "running" | "finished" | "failed" | "interrupted";
  error?: string;
  /** The user looked at the result and kept it. */
  accepted?: boolean;
  /** Everything needed to start it later, exactly as sent. */
  input: TurnInput;
};

/** What a task card shows (PRD B-FR2). */
export type TaskStatus =
  | "queued"
  | "running"
  | "needs-you"
  | "ready"
  | "accepted"
  | "undone"
  | "done"
  | "failed"
  | "interrupted";
