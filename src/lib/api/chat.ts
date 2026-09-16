import { Channel, invoke } from "@tauri-apps/api/core";

export type ChatRequest = {
  prompt: string;
  modelId: string;
};

export type ChatStreamEvent =
  | { event: "started" }
  | { event: "chunk"; data: { text: string } }
  | { event: "done"; data: { modelId: string } }
  | { event: "error"; data: { message: string } };

export type ChatStreamHandlers = {
  onStart?: () => void;
  onChunk: (text: string) => void;
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
