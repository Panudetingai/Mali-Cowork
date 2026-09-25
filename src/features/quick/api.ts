import type { Attachment } from "@/features/attachments";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { QuickConfig, QuickContext, QuickStatus } from "./types";

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

/** Open the region-selection overlay (Windows). */
export function startCaptureOverlay() {
  return invoke<void>("quick_start_capture_overlay");
}
