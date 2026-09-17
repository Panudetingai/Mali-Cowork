// OpenCode CLI feature types
// Docs: https://opencode.ai/docs/cli/

export type OpencodeRequest = {
  prompt: string;
  /** provider/model format, e.g. "openai/gpt-5" or "opencode/muse-spark-1.2-contributor-free" */
  model?: string;
  /** working directory for the agent. OpenCode flag: `--dir` */
  cwd?: string;
  /** show thinking blocks. OpenCode flag: `--thinking` */
  thinking?: boolean;
  /** auto-approve permissions. OpenCode flag: `--auto` */
  autoApprove?: boolean;
  /** attach to a running opencode server. OpenCode flag: `--attach` */
  attach?: string;
};

export type OpencodeCheckResult = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export type OpencodeModelsResult = {
  models: string[];
  providers: string[];
};

export type OpencodeConfig = {
  cwd: string;
  model: string;
  thinking: boolean;
  autoApprove: boolean;
};
