import type { Attachment } from "@/features/attachments";
import type { TurnFiles } from "@/features/checkpoints";
import type { TodoItem } from "./api/chat";

export type ChatRole = "user" | "assistant" | "error";

export type AgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  cost?: number;
};

export type ActivityItem = {
  /** Stable id; updates with the same id replace the earlier entry. */
  id?: string;
  kind: string;
  title: string;
  detail?: string;
  done: boolean;
  durationMs?: number;
  /**
   * Length of the reply text when the step started, so text and steps render
   * in the order they happened. Missing on replies saved before this existed.
   */
  offset?: number;
};

/**
 * A one-tap way out of an error: the key the run was missing, or the sign-in
 * it needed. Kept on the error message so the offer stays where the failure
 * is, instead of a dialog jumping in front of the user.
 */
export type ErrorFix =
  | {
      kind: "provider-key";
      providerId: string;
      /** Where the key belongs; see `requestProviderKey`. */
      target?: "opencode" | "api";
      modelName?: string;
      /** A key is saved already, but the provider turned it down. */
      invalid?: boolean;
    }
  | { kind: "cursor-login" };

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  activities?: ActivityItem[];
  /** Agent task plan / todo checklist. */
  todos?: TodoItem[];
  /** Cowork: files the turn ending with this message changed, with undo. */
  turn?: TurnFiles;
  modelId?: string;
  createdAt?: number;
  isStreaming?: boolean;
  // Agent metadata (cursor/opencode), kept even when the run fails.
  sessionId?: string;
  usage?: AgentUsage;
  durationMs?: number;
  /** Files and pictures sent with a user message. */
  attachments?: Attachment[];
  /** On an error: what the user can do about it, offered in the message. */
  fix?: ErrorFix;
  /** Thumbs up/down on a finished assistant reply. */
  feedback?: "up" | "down";
  /** What the user asked with: lets "retry" resend without the picker. */
  resend?: {
    modelId: string;
    modelName: string;
    maxTokens: number;
    autoNewChat: boolean;
    /** How hard the model was asked to think; kept so a retry matches. */
    effort?: string;
  };
};
