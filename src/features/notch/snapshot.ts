/**
 * Which run the pill shows, worked out from the main window's run store.
 * Pure, so the choice is tested without a window.
 */
import type { ChatRun, ChatSession } from "@/features/chat-history";
import type { CoworkBotId } from "@/features/cowork-bot";
import { groupTeamSteps } from "@/pages/chat/components/message/team-steps";
import type { ActivityItem } from "@/pages/chat/types";
import type { NotchMate, NotchSnapshot, NotchStep } from "./types";

/** How many recent steps the pill keeps; it shows three at a time. */
const STEPS = 4;
/** Chips that fit beside the steps. */
const MATES = 4;

/** The end of a long answer is the part worth showing in the notch. */
const REPLY_CHARS = 2400;

/** How much reply growth (chars) triggers a resync while a Cowork run streams. */
const REPLY_BUCKET = 384;

/**
 * Stable key for whether the pill needs a new snapshot. Omits streaming reply
 * text while working unless `streamReply` (the notch's own Cowork task).
 */
export function pillSyncKey(snapshot: NotchSnapshot | null, streamReply = false): string {
  if (!snapshot) return "null";
  const key = {
    phase: snapshot.phase,
    chatId: snapshot.chatId,
    taskId: snapshot.taskId,
    title: snapshot.title,
    waiting: snapshot.waiting,
    running: snapshot.running,
    permission: snapshot.permission?.id,
    command: snapshot.command,
    asker: snapshot.asker?.id,
    folder: snapshot.folder,
    changed: snapshot.changed,
    steps: snapshot.steps,
    todos: snapshot.todos,
    team: snapshot.team,
  };
  if (snapshot.phase === "done" || streamReply) {
    const len = snapshot.reply?.length ?? 0;
    const replyBucket = snapshot.phase === "done" ? len : Math.floor(len / REPLY_BUCKET);
    return JSON.stringify({ ...key, replyBucket });
  }
  return JSON.stringify(key);
}

/** A team bot as the pill needs it; the relay looks up its color. */
export type MateInfo = { id: string; name: string; mascot: CoworkBotId; color: string };

/**
 * An approval comes first, oldest run first, since the agent is stuck on it.
 * Otherwise the run whose chat changed last: that's the one moving.
 */
export function liveSnapshot(
  runs: Record<string, ChatRun>,
  chatOf: (id: string) => ChatSession | undefined,
  mates: MateInfo[] = [],
  /** The chat the notch is following (its own Cowork task), when it's running. */
  prefer?: string,
): NotchSnapshot | null {
  const ids = Object.keys(runs);
  if (ids.length === 0) return null;
  const waiting = ids.reduce((n, id) => n + runs[id].permissions.length, 0);
  const asking = ids.find((id) => runs[id].permissions.length > 0);
  const chatId =
    asking ??
    (prefer && runs[prefer] ? prefer : undefined) ??
    ids.reduce((latest, id) => ((chatOf(id)?.updatedAt ?? 0) > (chatOf(latest)?.updatedAt ?? 0) ? id : latest));
  const chat = chatOf(chatId);
  const reply = chat?.messages.filter((m) => m.role === "assistant").at(-1);
  const activities = reply?.activities ?? [];
  const permission = asking ? runs[asking].permissions[0] : undefined;
  const asked = permission ? askedBy(permission.title, mates) : undefined;
  return {
    phase: asking ? "permission" : "working",
    chatId,
    title: chat?.title ?? "",
    steps: recentSteps(activities),
    todos: reply?.todos ?? [],
    team: teamOf(activities, mates),
    permission,
    command: permission ? commandOf(permission.patterns, asked?.rest ?? permission.title) : undefined,
    asker: asked?.mate ? { id: asked.mate.id, name: asked.mate.name, mascot: asked.mate.mascot } : undefined,
    ...replyOf(chat),
    waiting,
    running: ids.length,
  };
}

/** The reply's text, the folder, and the files the turn changed. */
export function replyOf(chat: ChatSession | undefined): Pick<NotchSnapshot, "reply" | "folder" | "changed"> {
  const reply = chat?.messages.filter((m) => m.role === "assistant").at(-1);
  const text = reply?.content.trim() ?? "";
  return {
    reply: text.length > REPLY_CHARS ? `…${text.slice(-REPLY_CHARS)}` : text || undefined,
    folder: chat?.cwd,
    changed: reply?.turn && reply.turn.state === "applied" ? reply.turn.changes.length : undefined,
  };
}

/** The lead's own steps; a bot's steps show on its chip instead. */
function recentSteps(activities: ActivityItem[]): NotchStep[] {
  // A step without an id keys on its place in the reply, which doesn't move
  // as steps arrive, so the pill can animate it rolling by.
  return activities
    .map((a, i) => ({ id: a.id ?? `step:${i}`, kind: a.kind, title: a.title, done: a.done }))
    .filter((a) => !a.id.startsWith("team:"))
    .slice(-STEPS);
}

/** Each bot once, at its latest hand-off: what it's on, or done once it reported. */
function teamOf(activities: ActivityItem[], mates: MateInfo[]): NotchMate[] {
  const latest = new Map<string, NotchMate>();
  for (const group of groupTeamSteps(activities)) {
    if (group.type !== "team") continue;
    const mate = mates.find((m) => m.id === group.teammateId);
    if (!mate) continue;
    const done = !!group.report?.done;
    const step = group.steps.at(-1)?.title;
    latest.delete(mate.id);
    latest.set(mate.id, { ...mate, status: done ? "Done" : (step ?? mate.name), done });
  }
  return [...latest.values()].slice(-MATES);
}

/** A team bot's approval reads "Name · what it wants" (`relay_channel` in team.rs). */
function askedBy(title: string, mates: MateInfo[]) {
  const mate = mates.find((m) => title.startsWith(`${m.name} · `));
  return mate ? { mate, rest: title.slice(mate.name.length + 3) } : undefined;
}

/** The command itself reads best; the title when there is none. */
function commandOf(patterns: string[], title: string) {
  const command = patterns.filter((p) => p && p !== "*").join("\n");
  return command || title;
}
