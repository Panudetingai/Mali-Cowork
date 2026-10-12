/**
 * Your bots for agents on this computer (Claude Code, other CLIs): Mali
 * serves them as an MCP server on the loopback (`agent/bot_server.rs`), one
 * `ask_<bot>` tool each. The backend runs a bot from what the app sends it
 * here — its model and key, instructions and skills, connectors — so the app
 * sends it again whenever any of that changes.
 */
import { subscribeToInstructions } from "@/features/instructions";
import { hubMcpServers, subscribeToCustomMcps, subscribeToMcpConnections } from "@/features/mcp";
import { subscribeToProviderConfigs } from "@/features/providers";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { teammatePayload } from "./payload";
import { getTeam, subscribeToTeam } from "./store";

export type BotsMcpStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  token: string;
  /** `ask_<bot> — Name`, what callers see now. */
  tools: string[];
  error?: string | null;
};

/** The bots "As my own bot", each ready for a run of its own (in Chat mode: no folder). */
export async function publishBots() {
  const mates = getTeam().mates.filter((m) => m.personal && !m.paused);
  const servers = mates.some((m) => m.connectors.length) ? await hubMcpServers() : [];
  const bots = mates
    .map((m) => teammatePayload(m, servers, "chat"))
    .filter((b): b is NonNullable<typeof b> => !!b)
    // The agent that calls asked its own user first: Mali doesn't ask again.
    .map((b) => ({ ...b, approved: true }));
  await invoke("bots_mcp_publish", { bots });
}

/** Keep the backend's copy current. Returns the unsubscribe. */
export function startBotSharing(): () => void {
  if (!isTauri()) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void publishBots().catch(() => undefined), 400);
  };
  soon();
  const stops = [subscribeToTeam(soon), subscribeToInstructions(soon), subscribeToProviderConfigs(soon), subscribeToMcpConnections(soon), subscribeToCustomMcps(soon)];
  return () => {
    clearTimeout(timer);
    stops.forEach((stop) => stop());
  };
}

export const botsMcpStatus = () => invoke<BotsMcpStatus>("bots_mcp_status");

export async function setBotsMcpEnabled(enabled: boolean) {
  if (enabled) await publishBots();
  return invoke<BotsMcpStatus>("bots_mcp_set_enabled", { enabled });
}

export const resetBotsMcpToken = () => invoke<BotsMcpStatus>("bots_mcp_reset_token");

/** The command that adds your bots to Claude Code, in every project (`--scope user`). */
export function claudeCodeCommand(status: Pick<BotsMcpStatus, "url" | "token">) {
  return `claude mcp add --transport http --scope user mali-bots ${status.url} --header "Authorization: Bearer ${status.token}"`;
}

/** The same for any agent that reads an `mcpServers` JSON config. */
export function mcpJsonConfig(status: Pick<BotsMcpStatus, "url" | "token">) {
  return JSON.stringify({ mcpServers: { "mali-bots": { type: "http", url: status.url, headers: { Authorization: `Bearer ${status.token}` } } } }, null, 2);
}
