/**
 * Epic A contract (docs/PRD-delight-v0.3.md §6.2): Mali Anywhere — the Quick
 * bar opened by a global shortcut. UI code depends on these shapes only;
 * change them here first, never inline in a component.
 */
import type { Attachment } from "@/features/attachments";

/** Settings → Shortcuts. Mirrors `QuickConfig` in src-tauri/src/commands/quick.rs. */
export type QuickConfig = {
  enabled: boolean;
  /** Tauri accelerator, e.g. `CommandOrControl+Alt+M` (⌥⌘M on macOS). */
  shortcut: string;
  /** Closing the main window keeps Mali in the menu bar / tray (A-FR8). */
  trayMode: boolean;
  /** Model the Quick bar answers with (A-FR6); undefined = fastest with a key. */
  modelId?: string;
  /** Keep Quick bar chats in history under "Quick" (A-FR7). */
  saveToHistory: boolean;
};

/** Whether the shortcut is live; show `error` next to the field when not. */
export type QuickStatus = {
  registered: boolean;
  shortcut: string;
  error?: string;
};

/** Captured by Rust at the shortcut press, handed over once (A-FR2). */
export type QuickContext = {
  clipboardText?: string;
  /** Longer than 20 KB and was cut; say so on the chip. */
  clipboardTruncated: boolean;
  /** Epoch ms; 0 when the bar was opened without the shortcut. */
  openedAt: number;
};

/** A one-tap instruction (A-FR4). `{input}` is replaced by the text to work on. */
export type QuickAction = {
  id: string;
  label: string;
  prompt: string;
  /** A skill from the library runs instead of `prompt`. */
  skillId?: string;
  builtIn?: boolean;
};

export type QuickRequest = {
  /** What the user typed; may be empty when an action is picked. */
  prompt: string;
  action?: QuickAction;
  /** The clipboard chip, unless the user removed it. */
  clipboardText?: string;
  /** Screenshots from Capture screen. */
  attachments: Attachment[];
  modelId?: string;
};

/** Streamed back while the answer is written. */
export type QuickEvent =
  | { type: "text"; delta: string }
  | { type: "done"; text: string; chatId?: string }
  | { type: "error"; message: string };
