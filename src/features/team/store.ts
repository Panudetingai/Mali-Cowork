/**
 * Mali team: bots the user makes, each with one duty, its own model, skills
 * and connectors. In team mode the chat's model is the lead: it hands each
 * job to the bot whose duty it is (see `src-tauri/src/agent/team.rs`).
 *
 * Duties never overlap: a connector or a skill belongs to one bot only, so
 * the designer is the only one that designs.
 */
import { BOT_IDS, type CoworkBotId } from "@/features/cowork-bot";
import { createStore } from "@/lib/local-store";

/** Which file and command tools a bot gets; the agent enforces it. */
export type ToolScope = "none" | "read" | "files" | "all";

export const TOOL_SCOPES: { value: ToolScope; label: string; hint: string }[] = [
  { value: "none", label: "Connectors only", hint: "No files: works through its connectors" },
  { value: "read", label: "Read files", hint: "Reads the chat's folders, changes nothing" },
  { value: "files", label: "Change files", hint: "Writes and edits files (asks first)" },
  { value: "all", label: "Files and commands", hint: "Also runs commands (asks first)" },
];

export type Teammate = {
  id: string;
  name: string;
  mascot: CoworkBotId;
  /** Its duty in one sentence: the lead picks bots by it. */
  role: string;
  /** How it does the work: steps, style, what it hands back. */
  instructions: string;
  /** The model it runs on, as the picker spells it (`api:provider/model`). */
  modelId: string;
  /** Skill ids it owns; no other bot has them. */
  skills: string[];
  /** Connector ids it owns; no other bot, nor the lead, has them. */
  connectors: string[];
  tools: ToolScope;
  /** On the team: the lead calls it without asking; otherwise the user allows it first. */
  onTeam: boolean;
  /** Made by the user, or proposed by the lead and taken on. */
  origin: "user" | "lead";
  createdAt: number;
  /** The plugin that brought it (see `features/plugins`). */
  plugin?: string;
  /** Its plugin is turned off: kept, but the lead doesn't call it. */
  paused?: boolean;
};

export type TeammateDraft = Omit<Teammate, "id" | "createdAt" | "origin"> & Partial<Pick<Teammate, "id" | "origin">>;

/** A bot the lead would like on the team (the agent's `TeammateProposal`). */
export type TeammateProposal = {
  id: string;
  name: string;
  role: string;
  instructions: string;
  reason: string;
  tools: ToolScope;
  connectors: string[];
  /** Set when the coach rewrote how a bot on the team works: that bot's id. */
  updates?: string;
};

export type Proposal = TeammateProposal & {
  chatId?: string;
  at: number;
  /** Written because the notebook had enough of this work, not because a lead asked. */
  fromNotebook?: string;
};

/** A pattern with this many chats is enough to build a bot on (see `READY_AT` in `agent/coach.rs`). */
export const READY_AT = 3;

/** Something the user keeps doing, which the lead learned from their chats. */
export type Insight = {
  id: string;
  pattern: string;
  /** Titles of the chats that show it. */
  evidence: string[];
  count: number;
};

export type TeamState = {
  /** Team mode: the chat's model leads and hands work to the bots. */
  enabled: boolean;
  mates: Teammate[];
  /** Waiting for the user to take them on or turn them down. */
  proposals: Proposal[];
  /** Names of proposals the user turned down; the lead doesn't bring them up again. */
  declined: string[];
  /** A stronger API model that writes and coaches bots when the lead isn't sure. */
  coachModelId?: string;
  /** The lead keeps a notebook of what the user keeps doing. */
  learning: boolean;
  notebook: Insight[];
  /** Patterns the user removed from the notebook; they stay out. */
  forgotten: string[];
  /** When the notebook was last brought up to date (ms). */
  lastReflection?: number;
  /** Notebook patterns the coach already looked at for a bot, lower-cased; each is looked at once. */
  suggested: string[];
};

const EMPTY: TeamState = {
  enabled: false,
  mates: [],
  proposals: [],
  declined: [],
  learning: true,
  notebook: [],
  forgotten: [],
  suggested: [],
};

const isScope = (v: unknown): v is ToolScope => v === "none" || v === "read" || v === "files" || v === "all";
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function reviveMate(value: Partial<Teammate>): Teammate | null {
  if (!value || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    mascot: (BOT_IDS as readonly string[]).includes(value.mascot ?? "") ? value.mascot! : "mochi",
    role: typeof value.role === "string" ? value.role : "",
    instructions: typeof value.instructions === "string" ? value.instructions : "",
    modelId: typeof value.modelId === "string" ? value.modelId : "",
    skills: strings(value.skills),
    connectors: strings(value.connectors),
    tools: isScope(value.tools) ? value.tools : "read",
    onTeam: value.onTeam !== false,
    origin: value.origin === "lead" ? "lead" : "user",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    ...(typeof value.plugin === "string" ? { plugin: value.plugin } : {}),
    ...(value.paused === true ? { paused: true } : {}),
  };
}

const store = createStore<TeamState>(EMPTY, {
  key: "mali_team",
  revive: (value) => ({
    enabled: value?.enabled === true,
    mates: Array.isArray(value?.mates) ? value.mates.map(reviveMate).filter((m): m is Teammate => !!m) : [],
    proposals: Array.isArray(value?.proposals) ? value.proposals : [],
    declined: strings(value?.declined),
    coachModelId: typeof value?.coachModelId === "string" ? value.coachModelId : undefined,
    learning: value?.learning !== false,
    notebook: Array.isArray(value?.notebook) ? value.notebook.filter((i) => i && typeof i.pattern === "string") : [],
    forgotten: strings(value?.forgotten),
    lastReflection: typeof value?.lastReflection === "number" ? value.lastReflection : undefined,
    suggested: strings(value?.suggested),
  }),
});

export const useTeam = store.use;
export const getTeam = store.get;

export function setTeamEnabled(enabled: boolean) {
  store.set((s) => ({ ...s, enabled }));
}

/** The bot that owns a connector or a skill, other than `except`. */
export function ownerOf(
  mates: Teammate[],
  kind: "connectors" | "skills",
  id: string,
  except?: string,
): Teammate | undefined {
  return mates.find((m) => m.id !== except && m[kind].includes(id));
}

/** Why a draft can't be saved, or undefined when it can. */
export function draftIssue(mates: Teammate[], draft: TeammateDraft): string | undefined {
  if (!draft.name.trim()) return "Give the bot a name.";
  if (!draft.role.trim()) return "Say what its duty is: the lead picks bots by it.";
  if (!draft.modelId) return "Pick the model it runs on.";
  const sameName = mates.find((m) => m.id !== draft.id && m.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  if (sameName) return `There's a bot called ${sameName.name} already.`;
  for (const kind of ["connectors", "skills"] as const) {
    for (const id of draft[kind]) {
      const owner = ownerOf(mates, kind, id, draft.id);
      if (owner) return `${owner.name} already owns that ${kind === "connectors" ? "connector" : "skill"}: one duty, one bot.`;
    }
  }
  return undefined;
}

/** Add or update a bot in `mates`; throws when it would share another bot's duty. */
export function withTeammate(mates: Teammate[], draft: TeammateDraft, now = Date.now()): Teammate[] {
  const issue = draftIssue(mates, draft);
  if (issue) throw new Error(issue);
  const existing = draft.id ? mates.find((m) => m.id === draft.id) : undefined;
  const mate: Teammate = {
    ...draft,
    id: existing?.id ?? `mate_${crypto.randomUUID().slice(0, 8)}`,
    name: draft.name.trim(),
    role: draft.role.trim(),
    instructions: draft.instructions.trim(),
    origin: existing?.origin ?? draft.origin ?? "user",
    createdAt: existing?.createdAt ?? now,
  };
  return existing ? mates.map((m) => (m.id === mate.id ? mate : m)) : [...mates, mate];
}

export function saveTeammate(draft: TeammateDraft) {
  store.set((s) => ({ ...s, mates: withTeammate(s.mates, draft) }));
}

export function removeTeammate(id: string) {
  store.set((s) => ({ ...s, mates: s.mates.filter((m) => m.id !== id) }));
}

/** Pause bots (their plugin was turned off) or bring them back. */
export function setTeammatesPaused(ids: string[], paused: boolean) {
  const set = new Set(ids);
  store.set((s) => ({
    ...s,
    mates: s.mates.map((m) => {
      if (!set.has(m.id)) return m;
      const { paused: _was, ...rest } = m;
      return paused ? { ...rest, paused: true } : rest;
    }),
  }));
}

export function setOnTeam(id: string, onTeam: boolean) {
  store.set((s) => ({ ...s, mates: s.mates.map((m) => (m.id === id ? { ...m, onTeam } : m)) }));
}

/** A mascot no bot wears yet, so a new bot is told apart at a glance. */
export function freeMascot(mates: Teammate[]): CoworkBotId {
  return BOT_IDS.find((id) => !mates.some((m) => m.mascot === id)) ?? BOT_IDS[mates.length % BOT_IDS.length];
}

export function setCoachModel(coachModelId: string | undefined) {
  store.set((s) => ({ ...s, coachModelId }));
}

export function setLearning(learning: boolean) {
  store.set((s) => ({ ...s, learning }));
}

/** The notebook as the model returned it, with ids that survive the next update. */
export function setNotebook(insights: Omit<Insight, "id">[], at = Date.now()) {
  store.set((s) => {
    const idOf = (pattern: string) =>
      s.notebook.find((i) => i.pattern.toLowerCase() === pattern.toLowerCase())?.id ?? `insight_${crypto.randomUUID().slice(0, 8)}`;
    const forgotten = new Set(s.forgotten.map((f) => f.toLowerCase()));
    const notebook = insights
      .filter((i) => i.pattern.trim() && !forgotten.has(i.pattern.trim().toLowerCase()))
      .map((i) => ({ id: idOf(i.pattern), pattern: i.pattern.trim(), evidence: i.evidence ?? [], count: i.count || i.evidence?.length || 0 }));
    return { ...s, notebook, lastReflection: at };
  });
}

/** Take a pattern out of the notebook for good. */
export function forgetInsight(id: string) {
  store.set((s) => {
    const insight = s.notebook.find((i) => i.id === id);
    return {
      ...s,
      notebook: s.notebook.filter((i) => i.id !== id),
      forgotten: insight ? [...s.forgotten, insight.pattern] : s.forgotten,
    };
  });
}

/** Patterns there's enough of for a bot, that the coach hasn't looked at yet. */
export function readyPatterns(state: TeamState = store.get()): Insight[] {
  const looked = new Set(state.suggested);
  return state.notebook.filter((i) => i.count >= READY_AT && !looked.has(i.pattern.trim().toLowerCase()));
}

export function markSuggested(patterns: string[]) {
  store.set((s) => ({ ...s, suggested: [...new Set([...s.suggested, ...patterns.map((p) => p.trim().toLowerCase())])] }));
}

export function addProposal(proposal: TeammateProposal, chatId?: string, fromNotebook?: string) {
  store.set((s) => {
    // The same bot proposed (or coached) again replaces the earlier card.
    const key = (p: TeammateProposal) => `${p.updates ?? ""}:${p.name.trim().toLowerCase()}`;
    const others = s.proposals.filter((p) => key(p) !== key(proposal));
    return {
      ...s,
      proposals: [...others, { ...proposal, tools: isScope(proposal.tools) ? proposal.tools : "read", chatId, fromNotebook, at: Date.now() }],
    };
  });
}

/** A proposal as a draft to review; connectors another bot took since are left out. */
export function draftFromProposal(proposal: Proposal, modelId: string, mates = store.get().mates): TeammateDraft {
  return {
    name: proposal.name,
    mascot: freeMascot(mates),
    role: proposal.role,
    instructions: proposal.instructions,
    modelId,
    skills: [],
    connectors: proposal.connectors.filter((id) => !ownerOf(mates, "connectors", id)),
    tools: proposal.tools,
    onTeam: true,
    origin: "lead",
  };
}

/** Take a proposed bot on as it is, running on `modelId`; a coaching changes how its bot works. */
export function acceptProposal(id: string, modelId: string) {
  const proposal = store.get().proposals.find((p) => p.id === id);
  if (!proposal) return;
  if (proposal.updates) {
    store.set((s) => ({
      ...s,
      mates: s.mates.map((m) => (m.id === proposal.updates ? { ...m, instructions: proposal.instructions } : m)),
      proposals: s.proposals.filter((p) => p.id !== id),
    }));
    return;
  }
  store.set((s) => ({
    ...s,
    mates: withTeammate(s.mates, draftFromProposal(proposal, modelId, s.mates)),
    proposals: s.proposals.filter((p) => p.id !== id),
  }));
}

/** Drop a proposal the user took on after editing it. */
export function dismissProposal(id: string) {
  store.set((s) => ({ ...s, proposals: s.proposals.filter((p) => p.id !== id) }));
}

export function declineProposal(id: string) {
  store.set((s) => {
    const proposal = s.proposals.find((p) => p.id === id);
    // A coaching turned down just goes; the bot itself isn't declined.
    const remember = proposal && !proposal.updates && !s.declined.includes(proposal.name);
    return {
      ...s,
      proposals: s.proposals.filter((p) => p.id !== id),
      declined: remember ? [...s.declined, proposal.name] : s.declined,
    };
  });
}

/**
 * Connectors a bot's duty names ("Designs … in Canva") that it doesn't own:
 * without them the lead keeps the connector and does the work itself.
 * Matched by the connector's name; `connectors` are the installed ones.
 */
export function connectorsItNeeds(
  mate: Pick<Teammate, "role" | "instructions" | "connectors">,
  connectors: { id: string; name: string }[],
): { id: string; name: string }[] {
  const text = `${mate.role}\n${mate.instructions}`.toLowerCase();
  return connectors.filter((c) => {
    if (mate.connectors.includes(c.id)) return false;
    const word = c.name.toLowerCase().replace(/\s*(mcp|connector)$/i, "").trim();
    return word.length > 2 && text.includes(word);
  });
}

export type TeammateTemplate = Omit<TeammateDraft, "modelId">;

/** Ready-made bots to start from; the user picks the model, and connectors its duty names are picked for it. */
export const TEAMMATE_TEMPLATES: TeammateTemplate[] = [
  {
    name: "Momo Designer",
    mascot: "momo",
    role: "Designs posts, banners and slides in Canva. The only one on the team who designs.",
    instructions:
      "Work in Canva through its connector. Learn the design before changing it, keep the brand's colours and fonts, " +
      "keep every element inside the page, and look at the preview before you finish. Hand back the design link and " +
      "what you changed.",
    skills: [],
    connectors: [],
    tools: "read",
    onTeam: true,
  },
  {
    name: "Sora Researcher",
    mascot: "sora",
    role: "Finds and checks information: reads websites, documents and files, and sums up the facts with sources.",
    instructions:
      "Collect facts only from real sources and list each source's link. Keep numbers exact. Don't design or write the " +
      "final piece: hand back a clear summary for the teammate who does.",
    skills: [],
    connectors: [],
    tools: "read",
    onTeam: true,
  },
  {
    name: "Mikan Writer",
    mascot: "mikan",
    role: "Writes and edits copy: captions, articles, emails and reports, in the user's language and tone.",
    instructions:
      "Write from the facts you're given; don't research or design. Match the user's tone, keep it short, and hand " +
      "back the final text ready to use.",
    skills: [],
    connectors: [],
    tools: "files",
    onTeam: true,
  },
];
