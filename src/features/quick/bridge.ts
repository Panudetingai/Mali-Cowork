/**
 * Quick bar ⇄ main window. The main window owns chat history, so the Quick
 * bar hands a finished thread over instead of writing it itself.
 */
import { createChat, getChat, updateChatMessages } from "@/features/chat-history";
import type { Attachment } from "@/features/attachments";
import type { ChatMessage } from "@/pages/chat/types";
import { emitTo, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { openInMali } from "./api";
import type { QuickSavePayload } from "./types";

const SAVE = "quick:save";
const THEME = "quick:theme";
const THEME_REQUEST = "quick:theme-request";
const OPEN_SETTINGS = "quick:open-settings";
const CAPTURE_DONE = "quick:capture-done";
const CAPTURE_FAILED = "quick:capture-failed";

/** Quick bar: keep the thread as a chat, and with `open`, show it in Mali. */
export async function saveQuickThread(payload: QuickSavePayload) {
  if (!isTauri()) return;
  await emitTo("main", SAVE, payload);
  if (payload.open) await openInMali(payload.chatId);
}

/**
 * Main window: store threads the Quick bar hands over. The Quick bar sends
 * the whole thread after every answer, so a follow-up replaces the messages.
 */
export function listenForQuickSaves() {
  if (!isTauri()) return () => {};
  const stop = listen<QuickSavePayload>(SAVE, ({ payload }) => {
    if (payload.turns.length === 0) return;
    const first = payload.turns[0];
    if (!getChat(payload.chatId)) createChat(first.display, { id: payload.chatId, mode: "chat" });
    const now = Date.now();
    const messages: ChatMessage[] = payload.turns.flatMap((turn, i) => [
      {
        id: crypto.randomUUID(),
        role: "user",
        content: turn.request.clipboardText
          ? `${turn.display}\n\n> ${turn.request.clipboardText.trim().split("\n").join("\n> ")}`
          : turn.display,
        attachments: turn.request.attachments.length ? turn.request.attachments : undefined,
        createdAt: now + i * 2,
      },
      { id: crypto.randomUUID(), role: "assistant", content: turn.answer, modelId: turn.modelId, createdAt: now + i * 2 + 1 },
    ]);
    updateChatMessages(payload.chatId, () => messages);
  });
  return () => void stop.then((unlisten) => unlisten());
}

/**
 * The Quick bar follows the main window's theme. Each window keeps its own
 * copy, so the main window answers whenever the Quick bar asks.
 */
export function requestQuickTheme(apply: (theme: string) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<string>(THEME, ({ payload }) => apply(payload));
  void emitTo("main", THEME_REQUEST).catch(() => undefined);
  return () => void stop.then((unlisten) => unlisten());
}

/** Main window: answer theme requests, and push changes while the bar is open. */
export function serveQuickTheme(getTheme: () => string | undefined) {
  if (!isTauri()) return { push: () => {}, stop: () => {} };
  const push = () => {
    const theme = getTheme();
    if (theme) void emitTo("quick", THEME, theme).catch(() => undefined);
  };
  const stop = listen(THEME_REQUEST, push);
  return { push, stop: () => void stop.then((unlisten) => unlisten()) };
}

/** Quick bar: open Settings → Quick bar in the main window (e.g. to pick another model). */
export async function openQuickSettings() {
  if (!isTauri()) return;
  await emitTo("main", OPEN_SETTINGS);
  await openInMali();
}

/** Main window: go to Settings → Quick bar when the Quick bar asks. */
export function onOpenQuickSettings(handler: () => void) {
  if (!isTauri()) return () => {};
  const stop = listen(OPEN_SETTINGS, handler);
  return () => void stop.then((unlisten) => unlisten());
}

/** Quick bar: a region screenshot was captured from the overlay. */
export function onQuickCaptureDone(handler: (attachment: Attachment) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<Attachment>(CAPTURE_DONE, (event) => handler(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}

/** Quick bar: the overlay capture failed; `message` says why. */
export function onQuickCaptureFailed(handler: (message: string) => void) {
  if (!isTauri()) return () => {};
  const stop = listen<string>(CAPTURE_FAILED, (event) => handler(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}
