import type { ChatSession } from "@/features/chat-history";
import type { FileChange } from "@/features/checkpoints";
import { mcpToolOf } from "@/features/mcp/tool-label";
import type { ActivityItem, ChatMessage } from "@/pages/chat/types";
import type { ReceiptConnector, TimeSavedRates, WorkReceipt } from "./types";

/** Conservative on purpose: the number is shown as an estimate, never a claim. */
export const DEFAULT_TIME_SAVED_RATES: TimeSavedRates = {
  perFileCreated: 10,
  perFileModified: 5,
  perCommand: 1,
  perConnectorCall: 2,
};

type ToolResolver = (title: string) => { serverId: string; serverName: string } | undefined;

const FAILED = / \(failed\)$/;
const COMMAND_VERB = /^(run|bash|shell|exec|command)\b/i;

/** Same `Verb: subject` split as the agent steps list. */
function splitTitle(title: string) {
  const at = title.indexOf(": ");
  if (at <= 0 || at > 24) return { verb: title, subject: undefined };
  return { verb: title.slice(0, at), subject: title.slice(at + 2) };
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() || path;
const dirOf = (path: string) => path.slice(0, path.length - nameOf(path).length);

/**
 * Checkpoints only see a file vanish and another appear, so a rename or a move
 * reads as delete + add. Pair them back up: same size (and line counts when
 * known), plus the same name (moved) or the same folder (renamed).
 * Returns added path → deleted path.
 */
export function renamePairs(changes: FileChange[]) {
  const deleted = changes.filter((c) => c.kind === "deleted" && c.size !== undefined);
  const pairs = new Map<string, string>();
  const used = new Set<string>();
  for (const added of changes) {
    if (added.kind !== "added" || added.size === undefined) continue;
    const match = deleted.find(
      (d) =>
        !used.has(d.path) &&
        d.size === added.size &&
        (d.deletions === undefined || added.additions === undefined || d.deletions === added.additions) &&
        (nameOf(d.path) === nameOf(added.path) || dirOf(d.path) === dirOf(added.path)),
    );
    if (!match) continue;
    used.add(match.path);
    pairs.set(added.path, match.path);
  }
  return pairs;
}

/** A finished assistant reply that did agent work (steps or file changes). */
export function isWorkTurn(message: ChatMessage) {
  return (
    message.role === "assistant" &&
    !message.isStreaming &&
    (!!message.turn || (message.activities?.length ?? 0) > 0)
  );
}

function commandsOf(steps: ActivityItem[]) {
  const commands: string[] = [];
  for (const step of steps) {
    const { verb, subject } = splitTitle(step.title.replace(FAILED, ""));
    if (COMMAND_VERB.test(verb)) commands.push(subject ?? verb);
  }
  return commands;
}

function connectorsOf(steps: ActivityItem[], resolve: ToolResolver) {
  const byServer = new Map<string, ReceiptConnector>();
  for (const step of steps) {
    const tool = resolve(step.title.replace(FAILED, ""));
    if (!tool) continue;
    const row = byServer.get(tool.serverId) ?? { serverId: tool.serverId, name: tool.serverName, calls: 0 };
    row.calls += 1;
    byServer.set(tool.serverId, row);
  }
  return [...byServer.values()].sort((a, b) => b.calls - a.calls);
}

/**
 * The receipt for one reply, or undefined when the reply did no agent work.
 * Pure: everything comes from the saved message, so it works for old chats too.
 */
export function buildWorkReceipt(
  session: Pick<ChatSession, "id">,
  message: ChatMessage,
  resolveTool: ToolResolver = mcpToolOf,
): WorkReceipt | undefined {
  if (!isWorkTurn(message)) return undefined;
  const steps = message.activities ?? [];
  const changes = message.turn?.changes ?? [];
  const files = { added: 0, modified: 0, deleted: 0, renamed: 0, additions: 0, deletions: 0, changes };
  const renames = renamePairs(changes);
  const renamedFrom = new Set(renames.values());
  for (const change of changes) {
    // Same content under a new name: one changed file, no changed lines.
    if (renamedFrom.has(change.path)) continue;
    if (renames.has(change.path)) {
      files.renamed += 1;
      files.modified += 1;
      continue;
    }
    files[change.kind] += 1;
    files.additions += change.additions ?? 0;
    files.deletions += change.deletions ?? 0;
  }
  // Some agents don't report a turn time; the steps' own times still add up.
  const stepMs = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  return {
    chatId: session.id,
    messageId: message.id,
    finishedAt: message.createdAt,
    modelId: message.modelId,
    durationMs: message.durationMs ?? (stepMs > 0 ? stepMs : undefined),
    files,
    commands: commandsOf(steps),
    connectors: connectorsOf(steps, resolveTool),
    steps: { total: steps.length, failed: steps.filter((s) => FAILED.test(s.title)).length },
    usage: message.usage,
    checkpointId: message.turn?.checkpointId,
    state: message.turn?.state ?? "applied",
    partial: message.turn?.partial ?? false,
  };
}

/** Whole minutes; 0 for an undone turn, since its work was thrown away. */
export function estimateMinutesSaved(receipt: WorkReceipt, rates: TimeSavedRates = DEFAULT_TIME_SAVED_RATES) {
  if (receipt.state === "undone") return 0;
  const calls = receipt.connectors.reduce((sum, c) => sum + c.calls, 0);
  return Math.round(
    receipt.files.added * rates.perFileCreated +
      receipt.files.modified * rates.perFileModified +
      receipt.commands.length * rates.perCommand +
      calls * rates.perConnectorCall,
  );
}
