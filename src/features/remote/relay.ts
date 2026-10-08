/**
 * Main window ⇄ phones. The window owns the chats and runs: it publishes
 * their summary while a phone is open, and carries out what a phone asks
 * through the same pipeline the app uses (`pages/chat/turn.ts`).
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getChat,
  getChats,
  getRun,
  getRuns,
  isListedChat,
  sessionMode,
  subscribeToChats,
  subscribeToRuns,
} from "@/features/chat-history";
import { getOpencodeModels, loadOpencodeSettings, type PermissionReply, type WorkMode } from "@/features/opencode";
import { findGrant, normalizeFolder } from "@/features/workspace";
import { coworkResend } from "@/pages/chat/move-to-cowork";
import { loadSelectedModelId, resendSettingsFor, type AiModel } from "@/pages/chat/models";
import { answerAgentQuestion, replyToPermission, sendTurn, stopRun } from "@/pages/chat/turn";
import { setRemoteClients } from "./settings";
import { remoteChat, remoteState } from "./snapshot";
import type { RemoteCommand, RemoteModel, RemoteStatus } from "./types";

/** Phones see a change within this; the chat store changes on every token. */
const PUBLISH_MS = 500;
const PROMPT_MAX = 20_000;
const REPLIES: PermissionReply[] = ["once", "always", "reject"];

type Result = Record<string, unknown>;

const warn = (error: unknown) => console.warn("[remote]", error);

export function startRemoteRelay(modelsFor: (mode: WorkMode) => AiModel[]) {
  if (!isTauri()) return () => {};

  let clients = 0;
  let sent = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  function publish() {
    clearTimeout(timer);
    timer = undefined;
    if (clients === 0) return;
    const state = JSON.stringify(remoteState(getChats(), getRuns(), isListedChat));
    if (state === sent) return;
    sent = state;
    void invoke("remote_publish", { state }).catch(warn);
  }

  const schedule = () => {
    if (clients > 0) timer ??= setTimeout(publish, PUBLISH_MS);
  };

  const onClients = (count: number) => {
    const opened = count > clients;
    clients = count;
    setRemoteClients(count);
    // A phone that just opened gets the state as it is now.
    if (opened) {
      sent = "";
      publish();
    }
  };

  const listeners = [
    listen<number>("remote:clients", (event) => onClients(event.payload)),
    listen<{ id: string; command: RemoteCommand }>("remote:command", ({ payload }) => {
      void run(payload.command, modelsFor)
        .catch((error): Result => ({ error: String(error instanceof Error ? error.message : error) }))
        .then((result) => {
          schedule();
          return invoke("remote_reply", { id: payload.id, result });
        })
        .catch(warn);
    }),
  ];
  // A run going keeps the computer awake (its screen may still go dark), so a
  // phone can come back to it; the remote's side decides (`update_awake`).
  let busy: boolean | undefined;
  const followBusy = () => {
    const now = Object.keys(getRuns()).length > 0;
    if (now === busy) return;
    busy = now;
    void invoke("remote_set_busy", { busy: now }).catch(warn);
  };
  followBusy();

  const stops = [subscribeToChats(schedule), subscribeToRuns(schedule), subscribeToRuns(followBusy)];
  void invoke<RemoteStatus>("remote_status")
    .then((status) => onClients(status.clients))
    .catch(warn);

  return () => {
    clearTimeout(timer);
    stops.forEach((stop) => stop());
    void invoke("remote_set_busy", { busy: false }).catch(warn);
    listeners.forEach((stop) => void stop.then((unlisten) => unlisten()));
  };
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function modeOf(value: unknown): WorkMode {
  return value === "cowork" ? "cowork" : "chat";
}

async function run(command: RemoteCommand, modelsFor: (mode: WorkMode) => AiModel[]): Promise<Result> {
  switch (command?.kind) {
    case "chat": {
      const chat = getChat(text(command.chatId));
      if (!chat) return { error: "ไม่พบแชทนี้ อาจถูกลบในแอปแล้ว" };
      return { chat: remoteChat(chat, getRun(chat.id)) };
    }
    case "models":
      return models(modeOf(command.mode), modelsFor);
    case "send":
      return send(command, modelsFor);
    case "stop": {
      const chatId = text(command.chatId);
      if (!getRun(chatId)) return { ok: true };
      await stopRun(chatId);
      return { ok: true };
    }
    case "permission": {
      const chatId = text(command.chatId);
      const request = getRun(chatId)?.permissions.find((p) => p.id === command.id);
      if (!request) return { error: "คำขอนี้ถูกตอบไปแล้ว" };
      const reply = REPLIES.includes(command.reply) ? command.reply : "reject";
      await replyToPermission(chatId, request, reply);
      return { ok: true };
    }
    case "answer": {
      const chatId = text(command.chatId);
      const request = getRun(chatId)?.questions.find((q) => q.id === command.id);
      if (!request) return { error: "คำถามนี้ถูกตอบไปแล้ว" };
      const answers = Array.isArray(command.answers)
        ? command.answers.map((list) => (Array.isArray(list) ? list.map((a) => text(a, 2000)).filter(Boolean) : []))
        : [];
      await answerAgentQuestion(chatId, request, answers);
      return { ok: true };
    }
    default:
      return { error: "ไม่รู้จักคำสั่งนี้" };
  }
}

/**
 * The models a phone can pick. A CLI agent runs on the computer's own sign-in,
 * which the catalog can't always see (Codex's isn't checked at all), so it is
 * never locked — at worst its run says to sign in. Only a provider with no key
 * saved can't answer; it is listed, but can't be picked.
 */
function models(mode: WorkMode, modelsFor: (mode: WorkMode) => AiModel[]): Result {
  const list: RemoteModel[] = modelsFor(mode)
    .filter((m) => !m.media)
    .map((m) => {
      const cli = m.source === "cli";
      const note = m.needsKey ? "key" : m.issue && !cli ? "issue" : m.needsLogin ? "login" : undefined;
      return {
        id: m.id,
        name: m.name.replace(/\s*\((sign in|setup needed)\)\s*$/i, ""),
        group: m.group,
        source: m.source,
        free: m.free || undefined,
        note,
        disabled: !cli && !!(m.needsKey || m.issue),
      };
    });
  return { models: list, selected: loadSelectedModelId(mode) };
}

function defaultResend(mode: WorkMode) {
  return mode === "cowork"
    ? coworkResend()
    : resendSettingsFor(loadSelectedModelId("chat"), getOpencodeModels(), "chat");
}

/**
 * A prompt from the phone: into its chat, or a new one. Resolves once the
 * turn has started (with its chat), not when it ends.
 */
async function send(
  command: Extract<RemoteCommand, { kind: "send" }>,
  modelsFor: (mode: WorkMode) => AiModel[],
): Promise<Result> {
  const prompt = text(command.prompt, PROMPT_MAX).trim();
  if (!prompt) return { error: "พิมพ์ข้อความก่อนส่ง" };
  const chatId = text(command.chatId) || undefined;
  const chat = chatId ? getChat(chatId) : undefined;
  if (chatId && !chat) return { error: "ไม่พบแชทนี้ อาจถูกลบในแอปแล้ว" };
  if (chat && getRun(chat.id)) return { error: "แชทนี้ยังทำงานอยู่ — รอให้เสร็จ หรือกดหยุดก่อน" };
  const mode = chat ? sessionMode(chat) : modeOf(command.mode);

  // The folder question opens on the computer, where nobody may be: only
  // folders already allowed are used from the phone.
  if (mode === "cowork") {
    const cwd = normalizeFolder(chat?.cwd || loadOpencodeSettings().cwd);
    if (!cwd) return { error: "ยังไม่ได้เลือกโฟลเดอร์สำหรับ Cowork — เลือกในแอปก่อน" };
    if (!findGrant(cwd)) return { error: `ยังไม่ได้ให้สิทธิ์โฟลเดอร์ ${cwd} — อนุญาตในแอปบนคอมก่อน` };
  }

  const modelId = text(command.modelId) || undefined;
  const opencode = getOpencodeModels();
  const picked = modelId ? resendSettingsFor(modelId, opencode, mode) : undefined;
  if (modelId && !picked) {
    const blocked = modelsFor(mode).find((m) => m.id === modelId);
    if (blocked?.needsKey) return { error: "โมเดลนี้ยังไม่มี API key — ใส่ key ในแอปบนคอมก่อน (Settings → Models)" };
    return { error: "โมเดลนี้ใช้ในโหมดนี้ไม่ได้ — เลือกโมเดลอื่น" };
  }
  const last = chat?.messages.filter((m) => m.role === "user" && m.resend).at(-1)?.resend;
  const resend = picked ?? last ?? defaultResend(mode);
  if (!resend) return { error: "ยังไม่มีโมเดลที่ใช้ได้ — ตั้งค่าโมเดลในแอปก่อน" };

  if (chat) {
    void sendTurn({ chatId: chat.id, newChatMode: mode }, { prompt, resend }).catch(warn);
    return { chatId: chat.id };
  }
  let created: (id: string) => void = () => {};
  const createdId = new Promise<string>((resolve) => (created = resolve));
  const sent = sendTurn(
    { newChatMode: mode, onChatCreated: (c) => created(c.id) },
    { prompt, resend },
  );
  return Promise.race([
    createdId.then((id): Result => ({ chatId: id })),
    sent.then((ok): Result | Promise<Result> => (ok ? createdId.then((id) => ({ chatId: id })) : { error: "ส่งไม่สำเร็จ" })),
  ]);
}
