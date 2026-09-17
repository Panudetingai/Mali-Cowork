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
  // metadata จาก agent (cursor/opencode) แม้ตอน exit 1 ก็ได้
  sessionId?: string;
  usage?: AgentUsage;
  durationMs?: number;
};
