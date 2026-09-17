import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatStreamEvent, ChatStreamHandlers } from "./chat";

export type CliRequest = {
  prompt: string;
  agent: string;
  cwd?: string;
};

export async function cliGenerateStream(
  request: CliRequest,
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

  await invoke("cli_generate", {
    request: {
      prompt: request.prompt,
      agent: request.agent,
      cwd: request.cwd,
    },
    onEvent: channel,
  });
}
