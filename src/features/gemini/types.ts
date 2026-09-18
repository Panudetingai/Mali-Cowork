// Gemini CLI integration. Backend: src-tauri/src/commands/gemini
import type { FolderGrantInput, WorkMode } from "@/features/opencode";

export type GeminiRequest = {
  prompt: string;
  /** Model id passed as `-m`; `auto` lets Gemini choose. */
  model?: string;
  /** Cowork: the folder the agent works in. */
  cwd?: string;
  /** Session id to continue (`gemini -r <id>`). */
  sessionId?: string;
  mode?: WorkMode;
  /** Folders the user granted, the working folder included. */
  folders?: FolderGrantInput[];
  /** Identifies the run so it can be stopped. */
  runId: string;
};

export type GeminiCheckResult = {
  available: boolean;
  loggedIn: boolean;
  version?: string;
  path?: string;
  account?: string;
  error?: string;
};

export type GeminiModel = { id: string; name: string };
