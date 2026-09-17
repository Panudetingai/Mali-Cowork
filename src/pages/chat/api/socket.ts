import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatStreamEvent, ChatStreamHandlers } from "./chat";

export type SocketRequest = {
  prompt: string;
  baseUrl?: string;
  protocol?: "sse" | "ws" | "tcp";
};

export async function socketGenerateStream(
  request: SocketRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
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

  const baseUrl = request.baseUrl ?? "http://localhost:3000";
  const protocol = request.protocol ?? "sse";
  const command =
    protocol === "ws"
      ? "socket_ws_generate"
      : protocol === "tcp"
        ? "socket_tcp_generate"
        : "socket_generate";

  await invoke(command, {
    request: {
      prompt: request.prompt,
      baseUrl,
    },
    onEvent: channel,
  });
}

export async function isAgentServerUp(baseUrl = "http://localhost:3000"): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
    return r.ok;
  } catch {
    return false;
  }
}
