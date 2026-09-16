export type ChatRole = "user" | "assistant" | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  modelId?: string;
  createdAt?: number;
  isStreaming?: boolean;
};
