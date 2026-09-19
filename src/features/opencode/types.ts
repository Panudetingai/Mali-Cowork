// OpenCode integration types. Backend: src-tauri/src/commands/opencode

export type OpencodeRequest = {
  prompt: string;
  /** `provider/model`; the server default is used when omitted. */
  model?: string;
  /** Working directory for the agent. */
  cwd?: string;
  /** Continue this session instead of starting a new one. */
  sessionId?: string;
  /** Stream reasoning blocks. */
  thinking?: boolean;
  /** Approve every permission request without asking. */
  autoApprove?: boolean;
  /** `chat` answers without file access; `cowork` works in `cwd`. */
  mode?: WorkMode;
  /** Cowork: folders the user granted, the working folder first. */
  folders?: FolderGrantInput[];
  /** Attached pictures and documents (attachment paths). */
  files?: string[];
  /** Custom instructions and enabled skills, added to the system prompt. */
  instructions?: string;
};

export type FolderGrantInput = { path: string; access: "read" | "write" };

export type WorkMode = "chat" | "cowork";

export type OpencodeCheckResult = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export type OpencodeModel = {
  /** `provider/model` */
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  /** Costs nothing per token. */
  free: boolean;
  /** The provider has credentials, so the model can run now. */
  connected: boolean;
  /** Context window in tokens, when known. */
  contextLimit?: number | null;
  /** Can call tools (files, MCP); null when the model has no metadata. */
  toolCall?: boolean | null;
};

export type OpencodeProvider = {
  id: string;
  name: string;
  /** Environment variables the provider reads its key from. */
  env: string[];
  connected: boolean;
};

export type OpencodeModelsResult = {
  models: OpencodeModel[];
  defaultModel?: string | null;
  providers: OpencodeProvider[];
};

export type OpencodeSettings = {
  cwd: string;
  thinking: boolean;
  autoApprove: boolean;
};

export type PermissionReply = "once" | "always" | "reject";
