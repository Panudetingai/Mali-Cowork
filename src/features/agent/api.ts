/**
 * Mali's own agent (`src-tauri/src/agent`): Cowork on a provider's API with
 * the user's key, no OpenCode in between. It streams the same events as the
 * other agents, so the chat handles it like any of them.
 */
import type { McpServerEntry } from "@/features/mcp/sync";
import type { FolderGrantInput, WorkMode } from "@/features/opencode";
import type { TeamPayload } from "@/features/team";
import { createStreamChannel, isTauri, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { invoke } from "@tauri-apps/api/core";

export type AgentRequest = {
  prompt: string;
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  /** The chat's agent session, to carry on the conversation. */
  sessionId?: string;
  /** `cowork`: files, commands and connectors; `chat`: connectors only. */
  mode: WorkMode;
  /** Cowork: the folder the agent works in. */
  cwd?: string;
  folders: FolderGrantInput[];
  instructions?: string;
  effort?: string;
  /** Changes and commands run without asking (Settings). */
  autoApprove: boolean;
  /** Run shell commands inside the OS sandbox (Settings → Folders). */
  sandbox: boolean;
  /** The chat id; `agentAbort` stops it. */
  runId: string;
  /** Connectors that are on, reached through Mali's own MCP hub. */
  mcp: McpServerEntry[];
  /** Pictures sent with this prompt (attachment paths). */
  images: string[];
  /** The model's context budget; past most of it the agent summarises earlier turns. */
  contextLimit?: number;
  /** The model takes pictures: it can look at files, thumbnails and what tools return. */
  vision: boolean;
} & Partial<TeamPayload>;

export async function agentGenerateStream(request: AgentRequest, handlers: ChatStreamHandlers) {
  if (!isTauri()) throw new Error("The agent works in the Mali app only.");
  await invoke("agent_generate", { request, onEvent: createStreamChannel(handlers) });
}

/** Answer a permission card: `once`, `always` or `reject`. */
export function agentReplyPermission(id: string, reply: string) {
  return invoke<boolean>("agent_reply_permission", { id, reply });
}

/** Answer the agent's question; empty answers withdraw it. */
export function agentAnswerQuestion(id: string, answers: string[][]) {
  return invoke<boolean>("agent_answer_question", { id, answers });
}

export function agentAbort(runId: string) {
  return invoke<boolean>("agent_abort", { runId });
}
