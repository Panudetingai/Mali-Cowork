/**
 * `/bot <what it should do>` in the chat box: three bots written from those
 * words appear in the chat, each reading them a little differently, to look
 * over and save — no trip to Settings. The card is a message with no text,
 * so the model never hears it.
 */
import { getChat, updateChatMessages } from "@/features/chat-history";
import { BOT_IDS, type CoworkBotId } from "@/features/cowork-bot/store";
import { getInstructions } from "@/features/instructions";
import { catalogConnectorsSuggested, catalogServer, MCP_SERVERS } from "@/features/mcp";
import { RECOMMENDED_SKILLS } from "@/features/skills/recommended";
import { liveMessages } from "./compaction";
import { transcript } from "./summary";
import { getCustomMcps } from "@/features/mcp/custom";
import { getMcpConnections } from "@/features/mcp/store";
import {
  connectorsItNeeds,
  draftFromProposal,
  getTeam,
  modelCall,
  ownerOf,
  saveTeammate,
  skillsItNeeds,
  writeBot,
  type BotBlock,
  type TeammateProposal,
} from "@/features/team";
import type { BotMaker, BotOption, ChatMessage } from "./types";

/** The three readings of the same words, so there's a real choice. */
export const BOT_ANGLES = [
  { angle: "Focused", hint: "Keep it focused: the simplest bot that does exactly this, and nothing more." },
  { angle: "Thorough", hint: "Make it thorough: it also checks its own work and hands back a tidy, ready-to-use result." },
  {
    angle: "Another angle",
    hint: "Take a different angle on the same need: a different name and a different way of working than the obvious one.",
  },
] as const;

/** Options being written right now; one left unfinished after a restart reads as stopped. */
const writing = new Set<string>();
const key = (messageId: string, index: number) => `${messageId}:${index}`;

export function isWriting(messageId: string, index: number) {
  return writing.has(key(messageId, index));
}

/** Who writes the bots: the coach when there is one, else the model the user is chatting with. */
export function botWriterFor(chatModelId: string | undefined): string | undefined {
  return [getTeam().coachModelId, chatModelId].find((id) => !!modelCall(id, { cli: true }));
}

/** Put a bot maker in the chat and start writing its three bots. */
export function makeBotsInChat(chatId: string, words: string, chatModelId: string | undefined): string {
  const writerId = botWriterFor(chatModelId);
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    botMaker: {
      words,
      writerId,
      options: BOT_ANGLES.map(({ angle }) => ({
        angle,
        ...(writerId ? {} : { error: "Pick an API model or a CLI agent in the chat box to write bots with." }),
      })),
    },
  };
  updateChatMessages(chatId, (prev) => [...prev, message]);
  if (writerId) BOT_ANGLES.forEach((_, i) => void writeOption(chatId, message.id, i));
  return message.id;
}

/** Write (or write again) one of the options. */
export async function writeOption(chatId: string, messageId: string, index: number) {
  const maker = makerOf(chatId, messageId);
  if (!maker?.writerId || isWriting(messageId, index)) return;
  const angle = BOT_ANGLES[index] ?? BOT_ANGLES[0];
  writing.add(key(messageId, index));
  patchOption(chatId, messageId, index, () => ({ angle: angle.angle }));
  try {
    const proposal = await writeBot(`${maker.words}\n\n(${angle.hint})`, maker.writerId, chatContext(chatId, messageId));
    const draft = defaultDraftFor(proposal);
    patchOption(chatId, messageId, index, (o) => ({ ...o, proposal, ...draft, error: undefined }));
  } catch (e) {
    patchOption(chatId, messageId, index, (o) => ({ ...o, error: e instanceof Error ? e.message : String(e) }));
  } finally {
    writing.delete(key(messageId, index));
  }
}

/** Write all three again, keeping any already saved. */
export function rewriteAll(chatId: string, messageId: string) {
  makerOf(chatId, messageId)?.options.forEach((o, i) => {
    if (!o.savedId) void writeOption(chatId, messageId, i);
  });
}

/** A face for each option that no bot wears yet, so the three look apart. */
export function previewMascots(count: number = BOT_ANGLES.length): CoworkBotId[] {
  const worn = new Set(getTeam().mates.map((m) => m.mascot));
  const free = BOT_IDS.filter((id) => !worn.has(id));
  const pool = free.length >= count ? free : [...free, ...BOT_IDS.filter((id) => worn.has(id))];
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}

/**
 * Save an option as a bot of the user's own, on `modelId`: in the chat box's
 * model menu, and on the team when team mode is on. Returns the new bot's id.
 */
export function saveOption(chatId: string, messageId: string, index: number, modelId: string, mascot?: CoworkBotId): string {
  const option = makerOf(chatId, messageId)?.options[index];
  if (!option?.proposal) throw new Error("This bot isn't written yet.");
  const team = getTeam();
  const draft = {
    ...draftFromProposal({ ...option.proposal, at: Date.now() }, modelId, team.mates),
    name: uniqueName(option.proposal.name, team.mates.map((m) => m.name)),
    origin: "user" as const,
    personal: true,
    onTeam: team.enabled,
    tools: option.draftTools ?? option.proposal.tools,
    connectors: (option.draftConnectors ?? option.proposal.connectors).filter((id) => !ownerOf(team.mates, "connectors", id)),
    skills: (option.draftSkills ?? []).filter((id) => !ownerOf(team.mates, "skills", id)),
  };
  if (mascot && !team.mates.some((m) => m.mascot === mascot)) draft.mascot = mascot;
  saveTeammate(draft);
  const saved = getTeam().mates.find((m) => m.name === draft.name);
  if (!saved) throw new Error("Couldn't save the bot.");
  patchOption(chatId, messageId, index, (o) => ({ ...o, savedId: saved.id }));
  return saved.id;
}

/** "Writer", or "Writer 2" when a bot has that name already (two options may share one). */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const base = name.trim() || "My bot";
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function makerOf(chatId: string, messageId: string): BotMaker | undefined {
  return getChat(chatId)?.messages.find((m) => m.id === messageId)?.botMaker;
}

export function setOptionDraft(
  chatId: string,
  messageId: string,
  index: number,
  patch: Partial<Pick<BotOption, "draftConnectors" | "draftSkills" | "draftTools">>,
) {
  patchOption(chatId, messageId, index, (o) => ({ ...o, ...patch }));
}

function patchOption(chatId: string, messageId: string, index: number, fn: (option: BotOption) => BotOption) {
  updateChatMessages(chatId, (prev) =>
    prev.map((m) =>
      m.id === messageId && m.botMaker
        ? { ...m, botMaker: { ...m.botMaker, options: m.botMaker.options.map((o, i) => (i === index ? fn(o) : o)) } }
        : m,
    ),
  );
}

/** About how much of the chat the writer reads, in tokens. */
const CONTEXT_TOKENS = 6000;

/**
 * What was said in the chat before the bot maker, so "a bot from this
 * session" or "like above" means something to the writer.
 */
function chatContext(chatId: string, messageId: string): string | undefined {
  const chat = getChat(chatId);
  if (!chat) return undefined;
  const live = liveMessages(chat);
  const at = live.findIndex((m) => m.id === messageId);
  return transcript(at >= 0 ? live.slice(0, at) : live, CONTEXT_TOKENS) || undefined;
}

/**
 * The bots a reply's ```bot blocks hold, put on the reply as a bot maker so
 * they're looked over and saved like `/bot`'s. The AI names connectors and
 * skills loosely: they're matched to what's installed, and the rest becomes
 * what to install.
 */
export function attachReplyBots(chatId: string, messageId: string, bots: BotBlock[]) {
  const connectors = installedConnectorsNamed();
  const library = getInstructions().skills;
  const norm = (s: string) => s.trim().toLowerCase().replace(/^(mali_)?custom-/, "");
  const options: BotOption[] = bots.map((bot, i) => {
    const matched: string[] = [];
    const install: string[] = [];
    const find: string[] = [];
    for (const want of bot.connectors) {
      const w = norm(want);
      const own = connectors.find((c) => c.id === want || norm(c.id) === w || c.name.toLowerCase() === w);
      if (own) matched.push(own.id);
      else if (MCP_SERVERS.some((s) => s.id === w)) install.push(w);
      else find.push(w);
    }
    const skillIds: string[] = [];
    const installSkills: string[] = [];
    for (const want of bot.skills ?? []) {
      const w = want.trim().toLowerCase();
      const own = library.find((k) => k.id === want || k.name.trim().toLowerCase() === w);
      if (own) skillIds.push(own.id);
      else if (RECOMMENDED_SKILLS.some((s) => s.id === w)) installSkills.push(w);
    }
    const proposal: TeammateProposal = {
      ...bot,
      id: `proposal_${crypto.randomUUID().slice(0, 12)}`,
      connectors: [...new Set(matched)],
      skills: [...new Set(skillIds)],
      installConnectors: [...new Set(install)],
      findConnectors: [...new Set(find)].slice(0, 2),
      installSkills: [...new Set(installSkills)],
    };
    return { angle: bots.length === 1 ? "From this chat" : `Option ${i + 1}`, proposal, ...defaultDraftFor(proposal) };
  });
  updateChatMessages(chatId, (prev) =>
    prev.map((m) => (m.id === messageId && !m.botMaker ? { ...m, botMaker: { words: "", fromReply: true, options } } : m)),
  );
}

function installedConnectorsNamed(): { id: string; name: string }[] {
  const connections = getMcpConnections();
  const custom = getCustomMcps();
  const ids = new Set([...custom.map((c) => c.id), ...Object.keys(connections)]);
  return [...ids].map((id) => {
    const own = custom.find((c) => c.id === id);
    const def = catalogServer(id);
    return { id, name: own?.name ?? def?.name ?? id };
  });
}

function defaultDraftFor(proposal: TeammateProposal): Pick<BotOption, "draftConnectors" | "draftSkills" | "draftTools"> {
  const team = getTeam();
  const mate = { role: proposal.role, instructions: proposal.instructions, connectors: proposal.connectors, skills: [] as string[] };
  const installed = installedConnectorsNamed();
  const needed = connectorsItNeeds(mate, installed);
  const installedIds = new Set(installed.map((c) => c.id));
  const fromCatalog = catalogConnectorsSuggested(proposal.role, proposal.instructions, installedIds)
    .map((s) => s.id)
    .filter((id) => installedIds.has(id));
  const draftConnectors = [
    ...new Set([
      ...proposal.connectors.filter((id) => !ownerOf(team.mates, "connectors", id)),
      ...needed.filter((c) => !ownerOf(team.mates, "connectors", c.id)).map((c) => c.id),
      ...fromCatalog.filter((id) => !ownerOf(team.mates, "connectors", id)),
    ]),
  ];
  // The writer's picks, and any skill its duty names.
  const library = getInstructions().skills;
  const draftSkills = [
    ...new Set([
      ...(proposal.skills ?? []).filter((id) => library.some((k) => k.id === id && k.enabled)),
      ...skillsItNeeds(mate, library).map((k) => k.id),
    ]),
  ].filter((id) => !ownerOf(team.mates, "skills", id));
  return { draftTools: proposal.tools, draftConnectors, draftSkills };
}
