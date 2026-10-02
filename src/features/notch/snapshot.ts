/**
 * Which run the pill shows, worked out from the main window's run store.
 * Pure, so the choice is tested without a window.
 */
import type { ChatRun, ChatSession } from "@/features/chat-history";
import { extractChatBlocks } from "@/features/chat-blocks";
import { parseUnifiedDiff } from "@/components/diff/parse-unified";
import type { CoworkBotId } from "@/features/cowork-bot";
import { groupTeamSteps } from "@/pages/chat/components/message/team-steps";
import type { ActivityItem, ChatMessage } from "@/pages/chat/types";
import type {
  NotchEdit,
  NotchMate,
  NotchRecap,
  NotchSession,
  NotchShowcase,
  NotchSnapshot,
  NotchStep,
  NotchUsage,
} from "./types";

/** How many recent steps the pill keeps; it shows three at a time. */
const STEPS = 4;
/** Chips that fit beside the steps. */
const MATES = 4;

/** The end of a long answer is the part worth showing in the notch. */
const REPLY_CHARS = 2400;
/** Files the pill keeps from a run, and the diff lines it keeps of each. */
const EDITS = 3;
const EDIT_LINES = 8;
const LINE_CHARS = 140;

/**
 * Stable key for whether the pill needs a new snapshot. Omits streaming reply
 * text while working unless `streamReply` (the notch's own Cowork task, whose
 * answer the notch writes out as it comes).
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
    // Pages and pictures arrive as the answer is written: each one counts.
    showcase: snapshot.showcase?.map((s) => s.items.length),
    steps: snapshot.steps,
    todos: snapshot.todos,
    team: snapshot.team,
    // A diff can grow while its step runs: its size counts, not its text.
    edits: snapshot.edits?.map((e) => `${e.id}:${e.additions}:${e.deletions}`),
    failed: snapshot.failed,
  };
  if (snapshot.phase === "done" || streamReply) {
    return JSON.stringify({ ...key, reply: snapshot.reply?.length ?? 0 });
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
    startedAt: startOf(chat),
    permission,
    command: permission ? commandOf(permission.patterns, asked?.rest ?? permission.title) : undefined,
    asker: asked?.mate ? { id: asked.mate.id, name: asked.mate.name, mascot: asked.mate.mascot } : undefined,
    ...replyOf(chat),
    waiting,
    running: ids.length,
  };
}

/**
 * The reply's text, what it made, the folder, and the files the turn
 * changed. Galleries and pictures come out of the whole reply before its
 * text is cut to its end, so a long answer keeps its previews.
 */
export function replyOf(
  chat: ChatSession | undefined,
): Pick<NotchSnapshot, "reply" | "folder" | "changed" | "showcase" | "failed" | "edits"> {
  const reply = chat?.messages.filter((m) => m.role === "assistant").at(-1);
  const blocks = extractChatBlocks(reply?.content ?? "");
  const text = blocks.text.trim();
  const showcase = showcaseOf(blocks);
  const last = chat?.messages.at(-1);
  const edits = editsOf(reply?.activities ?? []);
  return {
    reply: text.length > REPLY_CHARS ? `…${text.slice(-REPLY_CHARS)}` : text || undefined,
    folder: chat?.cwd,
    changed: reply?.turn && reply.turn.state === "applied" ? reply.turn.changes.length : undefined,
    showcase: showcase.length ? showcase : undefined,
    failed: last?.role === "error" ? firstLine(last.content) : undefined,
    edits: edits.length ? edits : undefined,
  };
}

function firstLine(text: string, max = 160) {
  const line = text.trim().split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** When the run's prompt went out: the user's last message. */
function startOf(chat: ChatSession | undefined) {
  return chat?.messages.filter((m) => m.role === "user").at(-1)?.createdAt;
}

const WRITES = /^(write|edit|patch|update|create|overwrite|replace|multiedit|apply)/i;

/**
 * Files the run wrote, from its steps: an edit step's detail is a unified
 * diff (one entry per file in it); a write without one is a new file whose
 * first lines show as added. Only a few lines of each are kept: the pill
 * shows a taste, the app has the rest.
 */
export function editsOf(activities: ActivityItem[]): NotchEdit[] {
  const edits: NotchEdit[] = [];
  // From the end: only the last few are kept, so older diffs are never parsed.
  for (let i = activities.length - 1; i >= 0 && edits.length < EDITS; i--) {
    edits.unshift(...stepEdits(activities[i], i).slice(-(EDITS - edits.length)));
  }
  return edits;
}

function stepEdits(step: ActivityItem, i: number): NotchEdit[] {
  const [verb = "", ...rest] = step.title.trim().split(/\s+/);
  if (!WRITES.test(verb) || step.id?.startsWith("team:")) return [];
  const id = step.id ?? `step:${i}`;
  const detail = step.detail ?? "";
  const files = detail ? parseUnifiedDiff(detail) : [];
  if (files.length) {
    return files.map((file) => {
      const lines = file.diff.hunks.flatMap((h) => h.lines);
      // Start a line before the first change, so it reads in place.
      const from = Math.max(0, lines.findIndex((l) => l.tag !== "ctx") - 1);
      return {
        id: `${id}:${file.path}`,
        path: file.path,
        kind: file.created ? "added" : file.deleted ? "deleted" : "modified",
        additions: file.diff.additions,
        deletions: file.diff.deletions,
        lines: lines.slice(from, from + EDIT_LINES).map((l) => ({ tag: l.tag, text: clip(l.text) })),
      };
    });
  }
  const path = rest.join(" ");
  if (!path || !/^(write|create|overwrite)/i.test(verb)) return [];
  const body = detail ? detail.replace(/\r\n/g, "\n").split("\n") : [];
  return [
    {
      id: `${id}:${path}`,
      path,
      kind: "added",
      additions: body.length,
      deletions: 0,
      lines: body.slice(0, EDIT_LINES).map((text) => ({ tag: "add" as const, text: clip(text) })),
    },
  ];
}

function clip(text: string) {
  return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 1)}…` : text;
}

/** Chats the notch offers to pick up again. */
const SESSIONS = 8;
const ASKED_CHARS = 90;
const ANSWER_CHARS = 280;

/**
 * The few chats worth picking up from the notch: the ones running first,
 * then the most recent. Each is a handful of short strings, so the list
 * costs next to nothing to send.
 */
export function sessionsOf(
  chats: ChatSession[],
  runs: Record<string, ChatRun>,
  listed: (chat: ChatSession) => boolean = () => true,
): NotchSession[] {
  return chats
    .filter((c) => listed(c) && c.messages.length > 0)
    .sort((a, b) => Number(!!runs[b.id]) - Number(!!runs[a.id]) || b.updatedAt - a.updatedAt)
    .slice(0, SESSIONS)
    .map((chat) => {
      const run = runs[chat.id];
      const asked = chat.messages.filter((m) => m.role === "user").at(-1);
      const reply = chat.messages.filter((m) => m.role === "assistant").at(-1);
      const step = run ? reply?.activities?.filter((a) => !a.done && !a.id?.startsWith("team:")).at(-1) : undefined;
      const answer = extractChatBlocks(reply?.content ?? "").text.trim();
      const cowork = chat.mode === "cowork" || (!chat.mode && !!chat.cwd);
      return {
        id: chat.id,
        title: chat.title,
        folder: chat.cwd ? chat.cwd.split(/[\\/]/).filter(Boolean).at(-1) : undefined,
        cwd: chat.cwd,
        mode: chat.view === "code" ? "code" : cowork ? "cowork" : "chat",
        model: asked?.resend?.modelName ?? reply?.modelId?.split("/").at(-1),
        asked: asked ? clipTo(asked.content.replace(/\s+/g, " ").trim(), ASKED_CHARS) : undefined,
        answer: answer ? clipTo(answer, ANSWER_CHARS, true) : undefined,
        step: step ? { kind: verbOf(step.title), title: step.title } : undefined,
        running: !!run,
        waiting: !!run?.permissions.length,
        failed: chat.messages.at(-1)?.role === "error",
        updatedAt: chat.updatedAt,
      } satisfies NotchSession;
    });
}

const DAY_MS = 86_400_000;
const WEEK = 7;

function startOfDay(at: number) {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function tokensOf(usage: ChatMessage["usage"]) {
  if (!usage) return 0;
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/**
 * What the agent did today, and how many runs a day this week: each finished
 * reply is a run; its time, tokens, cost and the files it changed add up.
 * Chats untouched for a week are skipped without reading their messages.
 */
export function usageOf(chats: ChatSession[], now = Date.now()): NotchUsage {
  const today = startOfDay(now);
  const first = today - (WEEK - 1) * DAY_MS;
  const usage: NotchUsage = { runs: 0, seconds: 0, files: 0, tokens: 0, cost: 0, days: Array(WEEK).fill(0) };
  for (const chat of chats) {
    if (chat.updatedAt < first) continue;
    for (const message of chat.messages) {
      if (message.role !== "assistant" || message.isStreaming || !message.createdAt || message.createdAt < first) continue;
      const day = Math.min(WEEK - 1, Math.floor((startOfDay(message.createdAt) - first) / DAY_MS));
      usage.days[day]++;
      if (message.createdAt < today) continue;
      usage.runs++;
      usage.seconds += Math.round((message.durationMs ?? 0) / 1000);
      usage.tokens += tokensOf(message.usage);
      usage.cost += message.usage?.cost ?? 0;
      if (message.turn?.state === "applied") usage.files += message.turn.changes.length;
    }
  }
  return usage;
}

/** The Monday `weeks` back from the week `now` is in (its start, local time). */
export function weekStart(now: number, weeks = 0) {
  const day = new Date(startOfDay(now));
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7) - weeks * 7);
  return day.getTime();
}

const COMMANDS = /^(run|bash|shell|exec|command|terminal)/i;

/**
 * A week in numbers, Monday to Sunday: the tasks the agent finished and the
 * chats they were in, the files they made and changed, the commands they
 * ran, time, tokens and cost, tasks per model and per day. Chats untouched
 * since the week began are skipped unread.
 */
export function recapOf(chats: ChatSession[], weeks = 0, now = Date.now()): NotchRecap {
  const from = weekStart(now, weeks);
  const next = new Date(from);
  next.setDate(next.getDate() + 7);
  const to = next.getTime();
  const recap: NotchRecap = {
    week: weeks,
    from,
    to,
    tasks: 0,
    chats: 0,
    created: 0,
    edited: 0,
    commands: 0,
    seconds: 0,
    tokens: 0,
    cost: 0,
    models: [],
    days: Array(WEEK).fill(0),
  };
  const models = new Map<string, number>();
  for (const chat of chats) {
    if (chat.updatedAt < from) continue;
    let worked = false;
    let model: string | undefined;
    for (const message of chat.messages) {
      if (message.role === "user") model = message.resend?.modelName ?? model;
      if (message.role !== "assistant" || message.isStreaming || !message.createdAt) continue;
      if (message.createdAt < from || message.createdAt >= to) continue;
      worked = true;
      recap.tasks++;
      recap.days[(new Date(message.createdAt).getDay() + 6) % 7]++;
      recap.seconds += Math.round((message.durationMs ?? 0) / 1000);
      recap.tokens += tokensOf(message.usage);
      recap.cost += message.usage?.cost ?? 0;
      const name = model ?? message.modelId?.split("/").at(-1);
      if (name) models.set(name, (models.get(name) ?? 0) + 1);
      recap.commands += (message.activities ?? []).filter((a) => COMMANDS.test(verbOf(a.title))).length;
      if (message.turn?.state === "applied") {
        for (const change of message.turn.changes) {
          if (change.kind === "added") recap.created++;
          else recap.edited++;
        }
      }
    }
    if (worked) recap.chats++;
  }
  recap.models = [...models]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, tasks]) => ({ name, tasks }));
  return recap;
}

function clipTo(text: string, max: number, end = false) {
  if (text.length <= max) return text;
  return end ? `…${text.slice(-(max - 1))}` : `${text.slice(0, max - 1)}…`;
}

/** "Run npm test" → "Run": the tool, as the row's label. */
function verbOf(title: string) {
  return title.trim().split(/\s+/)[0] ?? "";
}

/** Galleries as they are; pictures (made or found) together as one more. */
export function showcaseOf({
  galleries,
  mediaPreviews,
}: Pick<ReturnType<typeof extractChatBlocks>, "galleries" | "mediaPreviews">): NotchShowcase[] {
  const shown: NotchShowcase[] = galleries
    .filter((g) => g.items.length > 0)
    .map((g) => ({
      source: g.source ?? g.connector,
      title: g.title,
      url: g.url,
      items: g.items.map((item) => ({ image: item.image, title: item.title, width: item.width, height: item.height })),
    }));
  const pictures = mediaPreviews
    .filter((m) => m.kind === "image")
    .map((m) => ({ image: m.thumbnail ?? m.url, local: m.local, title: m.title }));
  if (pictures.length) shown.push({ items: pictures });
  return shown;
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
