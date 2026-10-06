import { createStore } from "@/lib/local-store";
import { parseChatInstall, type ChatInstallRequest } from "./parse";

const requestStore = createStore<ChatInstallRequest | null>(null);

export const useChatInstallRequest = requestStore.use;

export function requestChatInstall(request: ChatInstallRequest) {
  requestStore.set(request);
}

export function closeChatInstallRequest() {
  requestStore.set(null);
}

/** True when the message was an install command (composer should clear, not send to AI). */
export function tryChatInstallFromPrompt(prompt: string): boolean {
  const parsed = parseChatInstall(prompt);
  if (!parsed) return false;
  requestChatInstall(parsed);
  return true;
}
