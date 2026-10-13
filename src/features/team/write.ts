/**
 * A bot from the user's own words: the coach (or any model the user picks)
 * writes its name, duty, instructions, file access and connectors, and the
 * user looks it over before it's added. Typed as `/bot <what it should do>`
 * in the chat box, where the bots appear to pick from (see `bot-maker.ts`).
 */
import { invoke } from "@tauri-apps/api/core";
import type { TeammateProposal } from "./store";
import { connectorList } from "./notebook";
import { modelCall } from "./payload";
import { getTeam } from "./store";
import { getInstructions } from "@/features/instructions";
import { getMcpConnections, getCustomMcps, MCP_SERVERS } from "@/features/mcp";
import { hasRecommendedSkill, RECOMMENDED_SKILLS } from "@/features/skills/recommended";

/** Write a bot for `need` on `modelId` (an API model or a CLI agent). */
export async function writeBot(need: string, modelId: string, context?: string): Promise<TeammateProposal> {
  const model = modelCall(modelId, { cli: true });
  if (!model) throw new Error("Pick a model to write the bot with.");
  const state = getTeam();
  const library = getInstructions().skills;
  const added = new Set([...Object.keys(getMcpConnections()), ...getCustomMcps().map((c) => c.id)]);
  return invoke<TeammateProposal>("team_write_bot", {
    request: {
      model,
      need,
      team: state.mates.map((m) => ({ id: m.id, name: m.name, role: m.role, mcp: m.connectors.map((id) => ({ id, enabled: true })) })),
      connectors: connectorList(),
      // The chat so far, for "a bot from this session".
      context: context ?? "",
      // Skills no bot has yet, for the writer to pick from.
      // What it could have installed, for the writer to recommend.
      catalogConnectors: MCP_SERVERS.filter((s) => !added.has(s.id)).map((s) => `${s.id} — ${s.name}: ${s.description}`),
      catalogSkills: RECOMMENDED_SKILLS.filter((s) => !hasRecommendedSkill(s, library)).map((s) => `${s.id} — ${s.name}: ${s.description}`),
      skills: library.filter((k) => k.enabled && !state.mates.some((m) => m.skills.includes(k.id)))
        .map((k) => `${k.id} — ${k.name}: ${k.description.replace(/\s+/g, " ").slice(0, 160)}`),
    },
  });
}

/** `/bot <words>` (or `/newbot`, `/สร้างบอท`) typed in the chat box: what the bot should do. */
export function botWordsIn(prompt: string): string | undefined {
  const match = /^\s*\/(?:bot|new-?bot|สร้างบอท)(?:\s+([\s\S]*))?$/i.exec(prompt);
  if (!match) return undefined;
  return (match[1] ?? "").trim();
}
