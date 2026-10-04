// Cursor Agent CLI integration. Backend: src-tauri/src/commands/cursor
import type { FolderGrantInput, WorkMode } from "@/features/opencode";

export type CursorRequest = {
  prompt: string;
  /** Model id from the CLI; `auto` lets Cursor choose. */
  model?: string;
  /** Cowork: the folder the agent works in. */
  cwd?: string;
  /** Cursor chat to continue. */
  sessionId?: string;
  mode?: WorkMode;
  /** Folders the user granted, the working folder included. */
  folders?: FolderGrantInput[];
  /** Identifies the run so it can be stopped. */
  runId: string;
  /** Attached pictures; Cursor opens them from their paths. */
  images?: string[];
};

export type CursorCheckResult = {
  available: boolean;
  loggedIn: boolean;
  version?: string;
  path?: string;
  /** Signed-in account, when the CLI reports one. */
  account?: string;
  error?: string;
};

export type CursorModel = { id: string; name: string };
