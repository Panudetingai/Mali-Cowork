import { Channel, invoke } from "@tauri-apps/api/core";

export type UseTools = {
  
}

export type ChatRequest = {
  prompt: string;
  modelId: string;
};

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
};

export type ChatStreamEvent =
  | { event: "started" }
  | { event: "chunk"; data: { text: string } }
  | { event: "reasoning"; data: { reasoning: string } }
  | { event: "activity"; data: ActivityItem }
  | { event: "metadata"; data: { sessionId?: string; usage?: AgentUsage; durationMs?: number; model?: string } }
  | { event: "done"; data: { modelId: string } }
  | { event: "error"; data: { message: string } };

export type ChatStreamHandlers = {
  onStart?: () => void;
  onChunk: (text: string) => void;
  onReasoning?: (reasoning: string) => void;
  onActivity?: (activity: ActivityItem) => void;
  onMetadata?: (data: { sessionId?: string; usage?: AgentUsage; durationMs?: number; model?: string }) => void;
  onDone: (modelId: string) => void;
  onError: (message: string) => void;
};

function isTauri() {
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}

export async function chatGenerateStream(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("AI streaming works in Tauri app only. Run: bun tauri dev");
  }

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
      case "metadata":
        handlers.onMetadata?.(message.data);
        break;
      case "done":
        handlers.onDone(message.data.modelId);
        break;
      case "error":
        handlers.onError(message.data.message);
        break;
    }
  };

  await invoke("chat_generate", {
    request: {
      prompt: request.prompt,
      modelId: request.modelId,
    },
    onEvent: channel,
  });
}
