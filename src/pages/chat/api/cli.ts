import { invoke } from "@tauri-apps/api/core";
import { createStreamChannel, type ChatStreamHandlers } from "./chat";

export type CliRequest = {
  prompt: string;
  agent: string;
  cwd?: string;
  /** A CLI the user added: what to run; `{prompt}` in `args` is filled in by the backend. */
  custom?: { name?: string; command: string; args: string[] };
  /** Custom instructions and skills, handed to the CLI as its own system instructions where it takes them. */
  instructions?: string;
  /** The CLI's own session to continue (Kilo, OpenCode). */
  sessionId?: string;
};

export type CliCheckResult = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export async function cliGenerateStream(
  request: CliRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  await invoke("cli_generate", {
    request,
    onEvent: createStreamChannel(handlers),
  });
}

export async function checkCli(agent: string): Promise<CliCheckResult> {
  return invoke<CliCheckResult>("check_cli", { agent });
}
