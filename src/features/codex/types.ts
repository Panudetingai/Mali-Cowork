// Codex CLI integration. Backend: src-tauri/src/commands/codex
import type { FolderGrantInput, WorkMode } from "@/features/opencode";

export type CodexRequest = {
  prompt: string;
  /** Model id passed as `-m`; `auto` lets Codex choose. */
  model?: string;
  /** Cowork: the folder the agent works in. */
  cwd?: string;
  /** Thread id to continue (`codex exec resume <id>`). */
  sessionId?: string;
  mode?: WorkMode;
  /** Folders the user granted, the working folder included. */
  folders?: FolderGrantInput[];
  /** Identifies the run so it can be stopped. */
  runId: string;
  /** Attached pictures (attachment paths). */
  images?: string[];
};

export type CodexCheckResult = {
  available: boolean;
  loggedIn: boolean;
  version?: string;
  path?: string;
  account?: string;
  error?: string;
};

export type CodexModel = { id: string; name: string };
