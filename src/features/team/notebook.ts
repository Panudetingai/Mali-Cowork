/**
 * The lead's notebook: what the user keeps doing, learned from their chats by
 * the coach (or the chat's model when it's an API model). The lead cites it
 * when it proposes a bot. It lives on this computer; the user sees it in
 * Settings → Team and can remove any line, or turn learning off.
 */
import { toast } from "@/components/ui/sonner";
import { getChat, getChatIds } from "@/features/chat-history";
import { catalogServer, getCustomMcps, getMcpConnections } from "@/features/mcp";
import { notify } from "@/features/notifications/notify";
import { invoke } from "@tauri-apps/api/core";
import { modelCall, type ModelCall } from "./payload";
import { addProposal, getTeam, markSuggested, readyPatterns, setNotebook, type Insight, type TeammateProposal } from "./store";

/** Brought up to date at most this often on its own. */
const EVERY_MS = 12 * 60 * 60 * 1000;
const MIN_CHATS = 3;

type ChatDigest = { title: string; asked: string };

/** The latest chats, each with what the user first asked in it. */
export function chatDigests(limit = 40): ChatDigest[] {
  return getChatIds()
    .map(getChat)
    .filter((c) => !!c && !c.ephemeral && !c.inboxTask && !!c.title.trim())
    .sort((a, b) => b!.updatedAt - a!.updatedAt)
    .slice(0, limit)
    .map((c) => ({
      title: c!.title.trim(),
      asked: (c!.messages.find((m) => m.role === "user")?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    }));
}

/** Which model keeps the notebook: the coach (API or CLI), else the chat's model when it's an API one. */
function notebookModel(fallbackModelId?: string) {
  return modelCall(getTeam().coachModelId, { cli: true }) ?? modelCall(fallbackModelId);
}

/** The user's connectors as the coach reads them: `id — name`. */
function connectorList(): string[] {
  const custom = getCustomMcps();
  const ids = new Set([...custom.map((c) => c.id), ...Object.keys(getMcpConnections())]);
  return [...ids].map((id) => `${id} — ${custom.find((c) => c.id === id)?.name ?? catalogServer(id)?.name ?? id}`);
}

/**
 * Enough of a kind of work in the notebook: the coach writes a bot for it,
 * unless a bot on the team already does it, and the card waits for the user.
 * Each pattern is looked at once. Returns how many bots were proposed.
 */
export async function suggestFromNotebook(model: ModelCall): Promise<number> {
  const state = getTeam();
  const ready = readyPatterns(state).slice(0, 2);
  if (!ready.length) return 0;
  const results = await invoke<[string, TeammateProposal | null][]>("team_suggest", {
    request: {
      model,
      patterns: ready.map(({ pattern, evidence, count }) => ({ pattern, evidence, count })),
      team: state.mates.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        mcp: m.connectors.map((id) => ({ id, enabled: true })),
      })),
      connectors: connectorList(),
      declined: state.declined,
    },
  });
  markSuggested(results.map(([pattern]) => pattern));
  const proposed = results.filter((r): r is [string, TeammateProposal] => !!r[1]);
  for (const [pattern, proposal] of proposed) addProposal(proposal, undefined, pattern);
  if (proposed.length) {
    const names = proposed.map(([, p]) => p.name).join(", ");
    toast(`New bot${proposed.length > 1 ? "s" : ""} for your team: ${names}`, {
      description: "Learned from the work you keep doing. Take it on in a new chat or in Settings → Team.",
    });
    void notify({ title: "Mali learned your work", body: `Proposed for your team: ${names}` }).catch(() => undefined);
  }
  return proposed.length;
}

/** Update the notebook now, then propose bots for what there's enough of. Throws when there's no model to do it with. */
export async function reflectNow(fallbackModelId?: string) {
  const model = notebookModel(fallbackModelId);
  if (!model) throw new Error("Pick a coach model in Settings → Team to keep the notebook.");
  const state = getTeam();
  const insights = await invoke<Omit<Insight, "id">[]>("team_reflect", {
    request: {
      model,
      chats: chatDigests(),
      notebook: state.notebook.map(({ pattern, evidence, count }) => ({ pattern, evidence, count })),
      forgotten: state.forgotten,
    },
  });
  setNotebook(insights);
  await suggestFromNotebook(model);
}

/** After a team run: update the notebook when it's due, quietly. */
export function maybeReflect(fallbackModelId?: string, now = Date.now()) {
  const state = getTeam();
  if (!state.enabled || !state.learning) return;
  if (state.lastReflection && now - state.lastReflection < EVERY_MS) return;
  if (chatDigests(MIN_CHATS).length < MIN_CHATS || !notebookModel(fallbackModelId)) return;
  void reflectNow(fallbackModelId).catch((error) => console.warn("[team] notebook update failed", error));
}
