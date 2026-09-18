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
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  activities?: ActivityItem[];
  modelId?: string;
  createdAt?: number;
  isStreaming?: boolean;
  // Agent metadata (cursor/opencode), kept even when the run fails.
  sessionId?: string;
  usage?: AgentUsage;
  durationMs?: number;
  /** Thumbs up/down on a finished assistant reply. */
  feedback?: "up" | "down";
  /** What the user asked with: lets "retry" resend without the picker. */
  resend?: {
    modelId: string;
    modelName: string;
    maxTokens: number;
    autoNewChat: boolean;
  };
};
