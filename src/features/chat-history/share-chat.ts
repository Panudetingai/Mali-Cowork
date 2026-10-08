import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChatMessage } from "@/pages/chat/types";
import type { ChatSession } from "./store";
import { createChat, getChat, updateChat } from "./store";

export const CHAT_SHARE_FORMAT = "mali-chat-share";
export const CHAT_SHARE_VERSION = 1;

export type ChatShareFile = {
  format: typeof CHAT_SHARE_FORMAT;
  version: typeof CHAT_SHARE_VERSION;
  exportedAt: number;
  session: {
    title: string;
    mode?: ChatSession["mode"];
    view?: ChatSession["view"];
    messages: ChatMessage[];
  };
};

function stripSession(session: ChatSession): ChatShareFile["session"] {
  return {
    title: session.title,
    mode: session.mode,
    view: session.view,
    messages: session.messages.map(({ id, role, content, modelId, reasoning, attachments, todos, resend }) => ({
      id,
      role,
      content,
      modelId,
      reasoning,
      attachments,
      todos,
      resend,
    })),
  };
}

export function chatToShareJson(session: ChatSession): string {
  const payload: ChatShareFile = {
    format: CHAT_SHARE_FORMAT,
    version: CHAT_SHARE_VERSION,
    exportedAt: Date.now(),
    session: stripSession(session),
  };
  return JSON.stringify(payload, null, 2);
}

/** A save-dialog name that keeps the chat title readable (incl. Thai). */
export function shareChatFileName(title: string, at = Date.now()): string {
  const illegal = /[<>:"/\\|?*\u0000-\u001f]/g;
  let safe = title.trim().normalize("NFKC").replace(illegal, "").replace(/\s+/g, " ").trim();
  if (!safe) safe = "Chat";
  if (safe.length > 56) safe = `${safe.slice(0, 56).trim()}…`;
  const date = new Date(at).toISOString().slice(0, 10);
  return `Mali chat - ${safe} - ${date}.mali-chat.json`;
}

export function parseChatShare(text: string): ChatShareFile {
  const value = JSON.parse(text) as ChatShareFile;
  if (value?.format !== CHAT_SHARE_FORMAT || value.version !== CHAT_SHARE_VERSION) {
    throw new Error("This file is not a Mali chat share (.mali-chat.json).");
  }
  if (!value.session?.title || !Array.isArray(value.session.messages)) {
    throw new Error("The share file is missing a title or messages.");
  }
  return value;
}

export async function exportChatShare(session: ChatSession): Promise<boolean> {
  const path = await save({
    title: "Share chat",
    defaultPath: shareChatFileName(session.title),
    filters: [{ name: "Mali chat share (.mali-chat.json)", extensions: ["json", "mali-chat"] }],
  });
  if (!path) return false;
  await writeTextFile(path, chatToShareJson(session));
  return true;
}

/** Import a shared chat as a new session (new id). */
export function importSharedChat(file: ChatShareFile, sourcePath?: string): ChatSession {
  const now = Date.now();
  const importedFrom = { sharedAt: file.exportedAt, file: sourcePath, title: file.session.title };
  const chat = createChat(file.session.title, {
    mode: file.session.mode,
    view: file.session.view,
    importedFrom,
  });
  updateChat(chat.id, (s) => ({
    ...s,
    messages: file.session.messages,
    updatedAt: now,
    createdAt: now,
  }));
  return getChat(chat.id)!;
}

export async function pickAndImportSharedChat(): Promise<ChatSession | null> {
  const path = await open({
    multiple: false,
    title: "Import shared chat",
    filters: [{ name: "Mali chat share", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  const text = await readTextFile(path);
  const file = parseChatShare(text);
  return importSharedChat(file, path);
}
