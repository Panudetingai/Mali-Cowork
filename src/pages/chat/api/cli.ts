import { invoke } from "@tauri-apps/api/core";
import { createStreamChannel, type ChatStreamHandlers } from "./chat";

export type CliRequest = {
  prompt: string;
  agent: string;
  cwd?: string;
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
