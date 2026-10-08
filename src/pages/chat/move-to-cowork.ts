/**
 * Move a Chat-mode chat to Cowork without starting over. The chat keeps its
 * messages; its agent sessions are dropped, so the Cowork agent starts a
 * fresh one in the folder and hears the conversation so far as a handoff
 * (see `missedBy` in turn.ts). Optionally the last request runs right away.
 */
import { getChat, getRun, sessionMode, updateChat } from "@/features/chat-history";
import { getOpencodeModels } from "@/features/opencode";
import { normalizeFolder, requestFolderAccess } from "@/features/workspace";
import { createStore } from "@/lib/local-store";
import { loadSelectedModelId, OPENCODE_DEFAULT_ID, resendSettingsFor } from "./models";
import { sendTurn } from "./turn";
import type { ChatMessage } from "./types";

export type MoveRequest = {
  chatId: string;
  /** What Cowork will do, as the model put it. */
  task?: string;
  /** Opened from the Chat/Cowork switch: also offer a fresh Cowork chat. */
  fromSwitch?: boolean;
};

const store = createStore<MoveRequest | null>(null);

export const useMoveToCoworkRequest = store.use;

/** Open the "Continue in Cowork" dialog for a chat. */
export function requestMoveToCowork(request: MoveRequest) {
  store.set(request);
}

export function closeMoveToCowork() {
  store.set(null);
}

/** The latest thing the user asked, to run again in Cowork. */
export function lastRequestOf(messages: ChatMessage[]) {
  return [...messages].reverse().find((m) => m.role === "user" && m.content.trim());
}

/** The Cowork model a moved chat runs on: the one picked for Cowork, else the default. */
export function coworkResend() {
  const opencode = getOpencodeModels();
  return (
    resendSettingsFor(loadSelectedModelId("cowork"), opencode, "cowork") ??
    resendSettingsFor(OPENCODE_DEFAULT_ID, opencode, "cowork")
  );
}

/** Why a move didn't happen; nothing changed. */
export type MoveRefusal = "running" | "already-cowork" | "no-access" | "gone";

/**
 * Resolves true once the chat is in Cowork (its last request may still be
 * starting), or with why it couldn't move.
 */
export async function moveChatToCowork(
  chatId: string,
  folder: string,
  { runLast }: { runLast: boolean },
): Promise<true | MoveRefusal> {
  const chat = getChat(chatId);
  if (!chat) return "gone";
  if (getRun(chatId)) return "running";
  if (sessionMode(chat) === "cowork") return "already-cowork";
  const cwd = normalizeFolder(folder);
  if (!cwd || !(await requestFolderAccess(cwd))) return "no-access";

  updateChat(chatId, (s) => ({
    ...s,
    mode: "cowork",
    cwd,
    // Chat-mode sessions ran without the folder; a fresh one gets the handoff.
    opencodeSessionId: undefined,
    cursorSessionId: undefined,
    codexSessionId: undefined,
    antigravitySessionId: undefined,
    cliSession: undefined,
    movedToCowork: { at: Date.now(), afterMessageId: s.messages.at(-1)?.id, folder: cwd },
    coworkHintDismissed: undefined,
  }));

  const last = lastRequestOf(chat.messages);
  const resend = coworkResend();
  if (!runLast || !last || !resend) return true;
  // Started, not awaited: `sendTurn` resolves only when the whole Cowork run
  // ends, and the move is done now. The run shows in the chat as usual.
  void sendTurn(
    { chatId, newChatMode: "cowork" },
    {
      prompt: last.content,
      context: last.context ?? "",
      attachments: last.attachments ?? [],
      resend: { ...resend, skills: last.resend?.skills, connectors: last.resend?.connectors },
    },
  ).catch((error) => console.warn("[cowork] couldn't start the moved request:", error));
  return true;
}
