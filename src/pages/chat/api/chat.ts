import { Channel, invoke } from "@tauri-apps/api/core";
import type { ActivityItem, AgentUsage } from "../types";

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  prompt: string;
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  history: HistoryMessage[];
  /** Custom instructions and enabled skills, sent as the system message. */
  system?: string | null;
};

export type StreamMetadata = {
  sessionId?: string;
  usage?: AgentUsage;
  durationMs?: number;
  model?: string;
};

export type PermissionRequest = {
  id: string;
  directory: string;
  permission: string;
  patterns: string[];
  title: string;
  detail?: string | null;
};

export type TodoItem = {
  id?: string;
  text: string;
  status?: string;
  done?: boolean;
};

export type ChatStreamEvent =
  | { event: "started" }
  | { event: "chunk"; data: { text: string } }
  | { event: "reasoning"; data: { reasoning: string } }
  | { event: "activity"; data: ActivityItem }
  | { event: "todos"; data: { items: TodoItem[] } }
  | { event: "metadata"; data: StreamMetadata }
  | { event: "permission"; data: PermissionRequest }
  | { event: "permissionResolved"; data: { id: string } }
  | { event: "done"; data: { modelId: string } }
  | { event: "error"; data: { message: string } };

export type ChatStreamHandlers = {
  onStart?: () => void;
  onChunk: (text: string) => void;
  onReasoning?: (reasoning: string) => void;
  onActivity?: (activity: ActivityItem) => void;
  onTodos?: (items: TodoItem[]) => void;
  onMetadata?: (data: StreamMetadata) => void;
  onPermission?: (request: PermissionRequest) => void;
  onPermissionResolved?: (id: string) => void;
  onDone: (modelId: string) => void;
  onError: (message: string) => void;
};

/** Channel that dispatches backend stream events to the given handlers. */
export function createStreamChannel(handlers: ChatStreamHandlers) {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (message) => {
    switch (message.event) {
      case "started":
        handlers.onStart?.();
        break;
      case "chunk":
        handlers.onChunk(message.data.text);
        break;
      case "reasoning":
        handlers.onReasoning?.(message.data.reasoning);
        break;
      case "activity":
        handlers.onActivity?.(message.data);
        break;
      case "todos":
        handlers.onTodos?.(message.data.items);
        break;
      case "metadata":
        handlers.onMetadata?.(message.data);
        break;
      case "permission":
        handlers.onPermission?.(message.data);
        break;
      case "permissionResolved":
        handlers.onPermissionResolved?.(message.data.id);
        break;
      case "done":
        handlers.onDone(message.data.modelId);
        break;
      case "error":
        handlers.onError(message.data.message);
        break;
    }
  };
  return channel;
}

export function isTauri() {
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

export async function chatGenerateStream(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("AI streaming works in Tauri app only. Run: bun tauri dev");
  }

  await invoke("chat_generate", {
    request,
    onEvent: createStreamChannel(handlers),
  });
}
