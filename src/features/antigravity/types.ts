// Antigravity CLI integration. Backend: src-tauri/src/commands/antigravity
import type { FolderGrantInput, WorkMode } from "@/features/opencode";

export type AntigravityRequest = {
  prompt: string;
  /** Model slug passed as `--model`; `auto` lets Antigravity choose. */
  model?: string;
  /** Cowork: the folder the agent works in. */
  cwd?: string;
  /** Conversation to continue (`agy --conversation <id>`). */
  sessionId?: string;
  mode?: WorkMode;
  /** Folders the user granted, the working folder included. */
  folders?: FolderGrantInput[];
  /** Identifies the run so it can be stopped. */
  runId: string;
  /** How hard the model should think; `low`, `medium` or `high`. */
  effort?: string;
};

export type AntigravityCheckResult = {
  available: boolean;
  loggedIn: boolean;
  version?: string;
  path?: string;
  account?: string;
  error?: string;
};

export type AntigravityModel = {
  id: string;
  name: string;
  /** Reasoning effort levels the model accepts, weakest first; empty for none. */
  efforts?: string[];
};
