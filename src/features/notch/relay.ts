/**
 * Main window: drive the notch pill from the run store. Every backend's
 * stream already lands there (`pages/chat/turn.ts`), so watching it covers
 * them all without touching a stream.
 *
 * The pill is for when the main window is away: it hides while the main
 * window has focus, and a run that ends while you're looking leaves no
 * done state behind.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getChat, getRun, getRuns, subscribeToChats, subscribeToRuns } from "@/features/chat-history";
import { BOTS } from "@/features/cowork-bot";
import { getTeam } from "@/features/team";
import { cancelTask, enqueueTask, getTasks, subscribeToTasks } from "@/features/tasks";
import { getOpencodeModels } from "@/features/opencode";
import { normalizeFolder, requestFolderAccess } from "@/features/workspace";
import { coworkResend } from "@/pages/chat/move-to-cowork";
import { resendSettingsFor } from "@/pages/chat/models";
import { replyToPermission, sendTurn, stopRun, type TurnInput } from "@/pages/chat/turn";
import {
  onNotchCowork,
  onNotchReady,
  onNotchReply,
  onNotchStop,
  releaseNotch,
  sendCoworkStarted,
  sendNotchState,
  showNotch,
} from "./bridge";
import { isNotchEnabled, subscribeToNotchEnabled } from "./settings";
import { liveSnapshot, pillSyncKey, replyOf, type MateInfo } from "./snapshot";
import type { NotchCoworkRequest, NotchCoworkStarted, NotchSnapshot } from "./types";

/** Run / permission / task changes — pill should react quickly. */
const RUN_THROTTLE_MS = 150;
/** Chat store updates on every token; steps/todos need less frequent syncs. */
const CHAT_THROTTLE_MS = 450;
/** The notch's own Cowork task: its answer streams into the notch, so it syncs often. */
const STREAM_THROTTLE_MS = 120;

function teamInfo(): MateInfo[] {
  return getTeam().mates.map((m) => ({
    id: m.id,
    name: m.name,
    mascot: m.mascot,
    color: BOTS.find((b) => b.id === m.mascot)?.color ?? "#8b8b8b",
  }));
}

export function startNotchRelay() {
  if (!isTauri()) return () => {};

  let focused = typeof document !== "undefined" && document.hasFocus();
  /** The run on the pill, kept after it ends so it can say it's done. */
  let last: NotchSnapshot | null = null;
  let runThrottle: ReturnType<typeof setTimeout> | undefined;
  let chatThrottle: ReturnType<typeof setTimeout> | undefined;
  let current: NotchSnapshot | null = null;
  let sent = "null";
  let shown = false;
  /** The approval the pill last took focus for; each one takes it once. */
  let focusedFor: string | undefined;
  /** The Cowork work the notch asked for last: by its request, then its task or chat. */
  let follow: { key: string; taskId?: string; chatId?: string } | undefined;
  const followedChat = () => follow?.chatId ?? getTasks().find((t) => t.id === follow?.taskId)?.chatId;

  const warn = (error: unknown) => console.warn("[notch]", error);

  function compute(): NotchSnapshot | null {
    if (!isNotchEnabled()) {
      last = null;
      return null;
    }
    const prefer = followedChat();
    const live = liveSnapshot(getRuns(), getChat, teamInfo(), prefer);
    if (live && prefer && live.chatId === prefer) live.taskId = follow?.key;
    if (live) last = live;
    else if (last?.phase === "done") {
      // The answer's last words and the files it changed land as the run ends.
      last = { ...last, ...replyOf(getChat(last.chatId)) };
    } else if (last) {
      last = {
        ...last,
        phase: "done",
        permission: undefined,
        command: undefined,
        asker: undefined,
        team: last.team.map((m) => ({ ...m, done: true, status: "Done" })),
        ...replyOf(getChat(last.chatId)),
        waiting: 0,
        running: 0,
      };
    }
    if (focused) {
      if (!live) last = null;
      return null;
    }
    return last;
  }

  function push() {
    runThrottle = undefined;
    chatThrottle = undefined;
    current = compute();
    const streamReply = !!follow && current?.phase === "working" && current.chatId === followedChat();
    const key = pillSyncKey(current, streamReply);
    if (key === sent) return;
    sent = key;
    if (!current) {
      shown = false;
      // Cleared too, not only hidden: notch mode keeps the pill up, and it
      // would go on showing the last step of work that has stopped.
      void sendNotchState(null).catch(warn);
      void releaseNotch().catch(warn);
      return;
    }
    const snapshot = current;
    const asking = snapshot.permission?.id;
    const focus = !!asking && asking !== focusedFor;
    focusedFor = asking;
    if (shown && !focus) {
      void sendNotchState(snapshot).catch(warn);
      return;
    }
    shown = true;
    // Show first: the first show creates the window, which then asks for
    // the state itself (`onNotchReady`) once it has loaded.
    void showNotch(focus)
      .then(() => sendNotchState(snapshot))
      .catch(warn);
  }

  function scheduleRun() {
    runThrottle ??= setTimeout(push, RUN_THROTTLE_MS);
  }

  function scheduleChat() {
    if (focused || !isNotchEnabled()) return;
    const streaming = !!follow && !!getRun(followedChat() ?? "");
    chatThrottle ??= setTimeout(push, streaming ? STREAM_THROTTLE_MS : CHAT_THROTTLE_MS);
  }

  const onFocus = () => {
    focused = true;
    scheduleRun();
  };
  const onBlur = () => {
    focused = false;
    scheduleRun();
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);

  /** Work in a folder, asked from the notch: the same pipeline as Cowork, via the Task Inbox. */
  async function startCowork(request: NotchCoworkRequest): Promise<NotchCoworkStarted> {
    const id = request.id;
    const cwd = normalizeFolder(request.folder);
    const granted =
      cwd && (await requestFolderAccess(cwd, { reason: "You asked Mali from the notch to work in this folder." }));
    if (!granted) return { id, error: "Mali can't use that folder — access was declined." };
    const opencode = getOpencodeModels();
    const resend = (request.modelId && resendSettingsFor(request.modelId, opencode, "cowork")) || coworkResend();
    if (!resend) return { id, error: "No model can work in folders yet — pick one for Cowork in the app." };
    const input: TurnInput = {
      prompt: request.prompt,
      attachments: request.attachments,
      resend: { ...resend, autoNewChat: resend.autoNewChat ?? false },
      context: request.context,
    };
    // A follow-up continues its chat, so the agent keeps the conversation.
    if (request.chatId && getChat(request.chatId) && !getRun(request.chatId)) {
      follow = { key: id, chatId: request.chatId };
      void sendTurn({ chatId: request.chatId, newChatMode: "cowork" }, input).catch(warn);
      return { id, chatId: request.chatId };
    }
    const task = enqueueTask({ input, folder: cwd });
    follow = { key: id, taskId: task.id };
    return { id, taskId: task.id };
  }

  const stops = [
    onNotchCowork((request) => {
      void startCowork(request)
        .catch((error): NotchCoworkStarted => ({ id: request.id, error: String(error) }))
        .then((answer) => {
          scheduleRun();
          return sendCoworkStarted(answer);
        })
        .catch(warn);
    }),
    subscribeToTasks(scheduleRun),
    subscribeToRuns(scheduleRun),
    subscribeToChats(scheduleChat),
    subscribeToNotchEnabled(scheduleRun),
    onNotchReady(() => void sendNotchState(current).catch(warn)),
    // Stop from the notch: a task by its Inbox entry (queued or running), else the chat's run.
    onNotchStop(({ chatId, taskId }) => {
      const stopping = taskId && getTasks().some((t) => t.id === taskId) ? cancelTask(taskId) : chatId ? stopRun(chatId) : undefined;
      void stopping?.catch(warn).finally(scheduleRun);
    }),
    onNotchReply(({ chatId, id, reply }) => {
      const request = getRun(chatId)?.permissions.find((p) => p.id === id);
      if (!request) return;
      void replyToPermission(chatId, request, reply).catch(warn);
    }),
  ];
  scheduleRun();

  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    stops.forEach((stop) => stop());
    clearTimeout(runThrottle);
    clearTimeout(chatThrottle);
  };
}
