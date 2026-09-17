// Re-export OpenCode feature module for backward compatibility.
// New code should import directly from `@/features/opencode`.

import { invoke } from "@tauri-apps/api/core";

export {
  opencodeCheck,
  opencodeDefaultCwd,
  opencodeGenerateRequestFromStorage,
  opencodeGenerateStream,
  opencodeListModels,
} from "@/features/opencode";

export type {
  OpencodeCheckResult,
  OpencodeModelsResult,
  OpencodeRequest,
} from "@/features/opencode";

export type CliCheckResult = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export async function checkCli(agent: string): Promise<CliCheckResult> {
  return invoke<CliCheckResult>("check_cli", { agent });
}
