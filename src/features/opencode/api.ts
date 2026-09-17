import type { ChatStreamEvent, ChatStreamHandlers } from "@/pages/chat/api/chat";
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
    OpencodeCheckResult,
    OpencodeModelsResult,
    OpencodeRequest,
} from "./types";

export { type OpencodeRequest } from "./types";

export async function opencodeCheck(): Promise<OpencodeCheckResult> {
  return invoke<OpencodeCheckResult>("opencode_check");
}

export async function opencodeListModels(): Promise<OpencodeModelsResult> {
  return invoke<OpencodeModelsResult>("opencode_list_models");
}

export async function opencodeDefaultCwd(): Promise<string> {
  return invoke<string>("opencode_default_cwd");
}

export function opencodeGenerateRequestFromStorage(
  prompt: string,
): OpencodeRequest {
  return {
    prompt,
    model: localStorage.getItem("opencode_model") || undefined,
    cwd: localStorage.getItem("opencode_cwd") || undefined,
    thinking: localStorage.getItem("opencode_thinking") === "true",
    autoApprove: localStorage.getItem("opencode_auto_approve") === "true",
  };
}

export async function opencodeGenerateStream(
  request: OpencodeRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (msg) => {
    switch (msg.event) {
      case "started":
        handlers.onStart?.();
        break;
      case "chunk":
        handlers.onChunk(msg.data.text);
        break;
      case "reasoning":
        handlers.onReasoning?.(msg.data.reasoning);
        break;
      case "activity":
        console.log("opencodeGenerateStream activity", msg.data);
        handlers.onActivity?.(msg.data);
        break;
      case "metadata":
        handlers.onMetadata?.(msg.data);
        break;
      case "done":
        handlers.onDone(msg.data.modelId);
        break;
      case "error":
        handlers.onError(msg.data.message);
        break;
    }
  };

  await invoke("opencode_generate", {
    request: {
      prompt: request.prompt,
      model: request.model ?? null,
      cwd: request.cwd ?? null,
      thinking: request.thinking ?? false,
      autoApprove: request.autoApprove ?? false,
      attach: request.attach ?? null,
    },
    onEvent: channel,
  });
}
