import type { Attachment } from "@/features/attachments";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { buildQuickPrompt } from "./actions";
import type { QuickConfig, QuickContext, QuickEvent, QuickRequest, QuickStatus } from "./types";

/**
 * `runQuickPrompt` still streams a canned answer. Everything else here talks
 * to the real backend (src-tauri/src/commands/quick.rs).
 * TODO(Claude Code, Epic A): send through `generateStream` in Chat mode, save
 * to history under "Quick", then flip this to false.
 */
const MOCK_RUN = true;

/** Only the Rust fields; model and history settings stay in the frontend. */
export function configureQuick({ enabled, shortcut, trayMode }: QuickConfig) {
  if (!isTauri()) return Promise.resolve<QuickStatus>({ registered: false, shortcut, error: "Not running in the app" });
  return invoke<QuickStatus>("quick_configure", { config: { enabled, shortcut, trayMode } });
}

/** Quick bar only: the clipboard captured at the shortcut press, once. */
export function takeQuickContext() {
  if (!isTauri()) return Promise.resolve<QuickContext>({ clipboardTruncated: false, openedAt: 0 });
  return invoke<QuickContext>("quick_take_context");
}

/** Quick bar only: the shortcut was pressed again while the bar was loaded. */
export function onQuickOpened(handler: () => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen("quick:opened", handler);
}

export function hideQuick() {
  return isTauri() ? invoke<void>("quick_hide") : Promise.resolve();
}

/** "Open in Mali": show the main window, on `chatId` when given. */
export function openInMali(chatId?: string) {
  return isTauri() ? invoke<void>("quick_open_main", { chatId }) : Promise.resolve();
}

/** Main window only: the Quick bar asked to show a chat. */
export function onOpenChatRequest(handler: (chatId: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<string>("quick:open-chat", (event) => handler(event.payload));
}

/**
 * Drag a region to attach (macOS). `null` when the user pressed Esc.
 * The first use asks for Screen Recording permission.
 */
export function captureScreen() {
  return invoke<Attachment | null>("quick_capture_screen");
}

/** Stream the answer; resolves when done. Abort with `signal`. */
export async function runQuickPrompt(
  request: QuickRequest,
  onEvent: (event: QuickEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const text = buildQuickPrompt(request);
  if (!text && request.attachments.length === 0) {
    onEvent({ type: "error", message: "พิมพ์ข้อความ หรือเลือก action ก่อน" });
    return;
  }
  if (MOCK_RUN) return mockRun(text, onEvent, signal);
  throw new Error("runQuickPrompt: not implemented");
}

async function mockRun(text: string, onEvent: (event: QuickEvent) => void, signal?: AbortSignal) {
  const answer = `(ตัวอย่างคำตอบ — ยังไม่ได้ต่อโมเดล)\n\nได้รับข้อความ ${text.length} ตัวอักษร:\n> ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`;
  let sent = "";
  for (const word of answer.split(/(?<=\s)/)) {
    if (signal?.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
    sent += word;
    onEvent({ type: "text", delta: word });
  }
  onEvent({ type: "done", text: sent });
}
