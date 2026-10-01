/**
 * The team as Mali's agent gets it with a lead's prompt: each bot with its
 * model, key, instructions, skills and connectors resolved, so its run needs
 * nothing from the app (see `Teammate` in `src-tauri/src/agent/team.rs`).
 * A bot on a CLI agent carries that agent's request instead of a key.
 */
import { getChat, getChatIds } from "@/features/chat-history";
import { buildInstructions, getInstructions, type InstructionsState } from "@/features/instructions";
import { hasEnabledMcp, hubMcpServers, syncMcpServers, type McpServerEntry } from "@/features/mcp";
import { getOpencodeModels, loadOpencodeSettings, type FolderGrantInput, type WorkMode } from "@/features/opencode";
import { providerContextLimit, requestConfigFor } from "@/features/providers";
import {
  antigravityModelOf,
  apiModelOf,
  codexModelOf,
  cursorModelOf,
  isAntigravityModel,
  isCodexModel,
  isCursorModel,
  isOpencodeModel,
  opencodeModelOf,
} from "@/pages/chat/models";
import { invoke } from "@tauri-apps/api/core";
import { getTeam, type Teammate, type TeamState } from "./store";

export type CliKind = "codex" | "cursor" | "antigravity" | "opencode";

export type TeammatePayload = {
  id: string;
  name: string;
  role: string;
  instructions: string;
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  /** A bot on a CLI agent: that agent's request, minus what each job fills in. */
  cli?: { kind: CliKind; request: Record<string, unknown> };
  vision: boolean;
  contextLimit?: number;
  tools: Teammate["tools"];
  mcp: McpServerEntry[];
  skills: string[];
  approved: boolean;
};

/** A model asked one question: an API model with the user's key, or a CLI agent. */
export type ModelCall = {
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  cli?: TeammatePayload["cli"];
};

export type TeamPayload = {
  lead: true;
  team: TeammatePayload[];
  recentWork: string[];
  declined: string[];
  /** The stronger model that writes and coaches bots for the lead. */
  coach?: ModelCall;
  /** What the user keeps doing, one line each, with the chats behind it. */
  notebook: string[];
};

/**
 * A model as the coach and `team_reflect` call it. API models always; a CLI
 * agent only with `cli` (the coach the user picked — never one started unasked).
 */
export function modelCall(modelId: string | undefined, { cli = false } = {}): ModelCall | undefined {
  if (!modelId) return undefined;
  const api = apiModelOf(modelId);
  if (api) return { provider: api.provider, model: api.model, ...requestConfigFor(api.provider) };
  const agent = cli ? cliAgentFor(modelId) : undefined;
  return agent ? { provider: "", model: "", apiKey: null, baseUrl: null, cli: agent } : undefined;
}

/** The notebook as the lead reads it. */
export function notebookLines(state: TeamState = getTeam()): string[] {
  if (!state.learning) return [];
  return state.notebook.map((i) => {
    const seen = i.evidence.slice(0, 3).map((t) => `"${t}"`).join(", ");
    return `${i.pattern} — ${i.count} chats${seen ? `, e.g. ${seen}` : ""}`;
  });
}

/** Team mode is on: the chat's model leads (only Mali's own agent can). */
export function teamActive(state: TeamState = getTeam()) {
  return state.enabled;
}

/** Skills and connectors the bots own, which the lead leaves to them. */
export function ownedByTeam(state: TeamState = getTeam()) {
  const on = teamActive(state);
  return {
    skills: new Set(on ? state.mates.flatMap((m) => m.skills) : []),
    connectors: new Set(on ? state.mates.flatMap((m) => m.connectors) : []),
  };
}

/** The lead's instructions: everyone's, minus the skills a bot owns. */
export function leadInstructions(state: InstructionsState = getInstructions()): InstructionsState {
  const owned = ownedByTeam().skills;
  return owned.size ? { ...state, skills: state.skills.filter((k) => !owned.has(k.id)) } : state;
}

/** Titles of the user's latest chats: what the lead learns their work from. */
export function recentWork(limit = 20): string[] {
  return getChatIds()
    .map(getChat)
    .filter((c) => !!c && !c.ephemeral && !c.inboxTask && !!c.title.trim())
    .sort((a, b) => b!.updatedAt - a!.updatedAt)
    .slice(0, limit)
    .map((c) => c!.title.trim());
}

/** Where a bot on this model runs: `api` on Mali's own agent, or a CLI agent; undefined when it can't. */
export function runsOn(modelId: string): "api" | CliKind | undefined {
  if (apiModelOf(modelId)) return "api";
  if (isCodexModel(modelId)) return "codex";
  if (isCursorModel(modelId)) return "cursor";
  if (isAntigravityModel(modelId)) return "antigravity";
  if (isOpencodeModel(modelId)) return "opencode";
  return undefined;
}

/** A CLI agent's request as its `*GenerateStream` sends it, minus prompt, session, run and folders. */
export function cliAgentFor(modelId: string): TeammatePayload["cli"] {
  switch (runsOn(modelId)) {
    case "codex":
      return { kind: "codex", request: { model: codexModelOf(modelId) ?? null, images: [], effort: null } };
    case "cursor":
      return { kind: "cursor", request: { model: cursorModelOf(modelId) ?? null } };
    case "antigravity":
      // Its key is only used when the CLI is set to Gemini (see `features/antigravity`).
      return {
        kind: "antigravity",
        request: { model: antigravityModelOf(modelId) ?? null, apiKey: requestConfigFor("google").apiKey, effort: null },
      };
    case "opencode":
      return {
        kind: "opencode",
        request: { model: opencodeModelOf(modelId) ?? null, thinking: loadOpencodeSettings().thinking, files: [], effort: null },
      };
    default:
      return undefined;
  }
}

/** One bot, ready for its own run; undefined when its model can't be a bot's. */
export function teammatePayload(
  mate: Teammate,
  servers: McpServerEntry[],
  mode: WorkMode,
  state: InstructionsState = getInstructions(),
): TeammatePayload | undefined {
  const api = apiModelOf(mate.modelId);
  const cli = api ? undefined : cliAgentFor(mate.modelId);
  if (!api && !cli) return undefined;
  const skills = state.skills.filter((k) => mate.skills.includes(k.id) && k.enabled !== false);
  const own = [
    mate.instructions.trim() && `# How ${mate.name} works\n${mate.instructions.trim()}`,
    buildInstructions({ custom: state.custom, skills: skills.map((k) => ({ ...k, enabled: true })) }, undefined, mode),
  ].filter(Boolean);
  const common = {
    id: mate.id,
    name: mate.name,
    role: mate.role,
    instructions: own.join("\n\n"),
    tools: mate.tools,
    skills: skills.map((k) => k.name),
    approved: mate.onTeam,
  };
  // A CLI agent reaches the connectors through its own setup; it is told which ones are its.
  if (!api) {
    const note = mate.connectors.length
      ? `\n\n# Your connectors\nUse only these connectors: ${mate.connectors.join(", ")}. Other connectors belong to other teammates.`
      : "";
    return { ...common, instructions: common.instructions + note, provider: "", model: "", apiKey: null, baseUrl: null, cli, vision: false, mcp: [] };
  }
  return {
    ...common,
    provider: api.provider,
    model: api.model,
    ...requestConfigFor(api.provider),
    vision: !!getOpencodeModels()
      ?.models.find((m) => m.id === `${api.provider}/${api.model}`)
      ?.input?.includes("image"),
    contextLimit: providerContextLimit(api.provider),
    mcp: servers.filter((s) => mate.connectors.includes(s.id)),
  };
}

/** What a lead's run carries about the team, or nothing when team mode is off. */
export async function teamPayload(
  mode: WorkMode,
  cwd?: string,
  folders: FolderGrantInput[] = [],
): Promise<TeamPayload | undefined> {
  const state = getTeam();
  if (!teamActive(state)) return undefined;
  const servers = state.mates.some((m) => m.connectors.length) ? await hubMcpServers(cwd) : [];
  // CLI bots get the connectors and Mali's document tools from the `mali` gateway, as a CLI lead does.
  if (state.mates.some((m) => runsOn(m.modelId) !== "api")) {
    await invoke("mcp_hub_set_workspace", { cwd: cwd ?? null, folders }).catch(() => undefined);
    if (hasEnabledMcp()) await syncMcpServers().catch(() => undefined);
  }
  return {
    lead: true,
    team: state.mates.map((m) => teammatePayload(m, servers, mode)).filter((m): m is TeammatePayload => !!m),
    recentWork: recentWork(),
    declined: state.declined,
    coach: modelCall(state.coachModelId, { cli: true }),
    notebook: notebookLines(state),
  };
}
