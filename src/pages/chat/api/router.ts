import { chatGenerateStream, type ChatStreamHandlers } from "./chat";
import { cliGenerateStream } from "./cli";
import {
  opencodeGenerateStream,
  opencodeGenerateRequestFromStorage,
} from "@/features/opencode";
import { isAgentServerUp, socketGenerateStream } from "./socket";

export type GenerateRequest = {
  prompt: string;
  modelId: string;
};

function getAgentBaseUrl(): string {
  return localStorage.getItem("agent_base_url") ?? "http://localhost:3000";
}

export async function generateStream(
  request: GenerateRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  // 1. Local CLI: modelId ขึ้นต้น cli: เช่น cli:opencode — opencode feature module
  if (request.modelId === "cli:opencode") {
    return opencodeGenerateStream(
      opencodeGenerateRequestFromStorage(request.prompt),
      handlers,
    );
  }
  if (request.modelId.startsWith("cli:")) {
    const agent = request.modelId.slice(4);
    return cliGenerateStream(
      { prompt: request.prompt, agent },
      handlers,
    );
  }

  // 2. Local Socket: modelId ขึ้นต้น socket: หรือ agent:
  if (
    request.modelId.startsWith("socket:") ||
    request.modelId.startsWith("agent:")
  ) {
    const baseUrl = getAgentBaseUrl();
    const isUp = await isAgentServerUp(baseUrl);
    if (!isUp) {
      handlers.onError(
        `Agent Server not running. Run: node agent-server/server.js (baseUrl: ${baseUrl})`,
      );
      return;
    }

    const protocol = request.modelId.includes(":ws")
      ? "ws"
      : request.modelId.includes(":tcp")
        ? "tcp"
        : "sse";

    return socketGenerateStream(
      { prompt: request.prompt, baseUrl, protocol },
      handlers,
    );
  }

  // 3. Provider API (default)
  return chatGenerateStream(request, handlers);
}
