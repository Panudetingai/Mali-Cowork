/**
 * Running a chat turn, outside React: sending, stopping, and answering what
 * the agent asks. `useChat` wraps these for the chat page; the Task Inbox runs
 * them for chats that aren't on screen.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  attachFolder,
  clearAgentSessions,
  createChat,
  endRun,
  getChat,
  getRun,
  sessionMode,
  startRun,
  updateChat,
  updateChatMessages,
  updateRun,
  type ChatSession,
} from "@/features/chat-history";
import { agentAbort, agentAnswerQuestion, agentReplyPermission } from "@/features/agent";
import type { Attachment } from "@/features/attachments";
import { addCheckpointFolder, beginCheckpoint, finishCheckpoint, type TurnFiles } from "@/features/checkpoints";
import { codexAbort } from "@/features/codex";
import { cursorAbort, requestCursorLogin } from "@/features/cursor";
import { antigravityAbort } from "@/features/antigravity";
import { connectorInstructionsFor, hasEnabledMcp, pickedConnectorInstructions, syncMcpServers } from "@/features/mcp";
import {
  getOpencodeModels,
  loadOpencodeSettings,
  opencodeAbort,
  opencodeReplyPermission,
  opencodeReplyQuestion,
  requestProviderKey,
  type PermissionReply,
  type WorkMode,
} from "@/features/opencode";
import { getProviderConfig } from "@/features/providers";
import { buildInstructions, getInstructions, skillSlug, skillsInPrompt, type Skill } from "@/features/instructions";
import { getProject, projectContext } from "@/features/projects";
import { skillsGrant } from "@/features/skills";
import { addProposal, leadInstructions, ownedByTeam } from "@/features/team";
import { findGrant, grantsFor, isWithin, normalizeFolder, requestFolderAccess } from "@/features/workspace";
import type { HistoryMessage, PermissionRequest, QuestionRequest, StreamMetadata, TodoItem } from "@/pages/chat/api/chat";
import { generateStream, runModelIdFor, runsOnMaliAgent } from "@/pages/chat/api/router";
import { contextUsage } from "./context-usage";
import { coworkInstructionsFor } from "./cowork-handoff";
import { summarizeConversation, transcript } from "./summary";
import {
  apiModelOf,
  isAntigravityModel,
  isCodexModel,
  isCursorModel,
  isOpencodeModel,
  opencodeProviderOf,
} from "./models";
import type { ActivityItem, ChatMessage, ErrorFix } from "./types";

const MAX_HISTORY = 40;

export type TurnInput = {
  prompt: string;
  resend: NonNullable<ChatMessage["resend"]>;
  attachments?: Attachment[];
  context?: string;
};

/** Where a turn goes: an existing chat, or a new one made like this. */
export type TurnTarget = {
  chatId?: string;
  newChatMode: WorkMode;
  newChatProjectId?: string;
  newChatView?: ChatSession["view"];
  /** A new chat was made for this turn (the chat page opens it). */
  onChatCreated?: (chat: ChatSession, info: { mode: WorkMode; projectId?: string }) => void;
};

/**
 * The shared send pipeline. New prompts, retries and the Task Inbox runs
 * all run through here, so a retry reproduces the original model and context
 * budget exactly. It only touches the history and run stores, so a turn keeps
 * going whether or not its chat is on screen.
 *
 * Resolves false when the message was not sent (e.g. folder access declined).
 */
export async function sendTurn(
  { chatId, newChatMode, newChatProjectId, newChatView, onChatCreated }: TurnTarget,
  { prompt, resend, attachments = [], context = "" }: TurnInput,
): Promise<boolean> {
  const modelId = resend.modelId;
  const budget = { maxTokens: resend.maxTokens, autoNewChat: resend.autoNewChat };
  let chat = chatId ? getChat(chatId) : undefined;
  const chatMode = chat ? sessionMode(chat) : newChatMode;
  // A project gives its chats instructions and skills (its folder is set
  // as the default before a new chat opens, see `newProjectChatUrl`).
  const projectId = chat ? chat.projectId : newChatProjectId;
  const project = getProject(projectId);

  let folders: string[] = [];
  if (chatMode === "cowork") {
    const cwd = normalizeFolder(chat?.cwd || loadOpencodeSettings().cwd);
    if (!(await requestFolderAccess(cwd))) return false;
    // Attached folders the user has since revoked are left out.
    const extra = (chat?.folders ?? []).filter((f) => f !== cwd && findGrant(f));
    folders = [cwd, ...extra];
  }

  // Past the provider's budget: carry on in a fresh chat, with a summary
  // of this one, instead of failing.
  let continuedFrom: ChatSession["continuedFrom"];
  let previous: ChatSession | undefined;
  if (
    chat &&
    chat.messages.length > 0 &&
    budget.autoNewChat &&
    contextUsage(chat.messages, prompt + context).usedTokens > budget.maxTokens
  ) {
    continuedFrom = { id: chat.id, title: chat.title, summarizing: true };
    previous = chat;
    chat = undefined;
  }

  if (!chat) {
    chat = createChat(prompt, {
      mode: chatMode,
      view: previous ? previous.view : newChatView,
      cwd: folders[0],
      continuedFrom,
      projectId: project?.id,
    });
    onChatCreated?.(chat, { mode: chatMode, projectId: project?.id });
  } else if (chatMode === "cowork" && !chat.cwd) {
    updateChat(chat.id, (s) => ({ ...s, cwd: folders[0] }));
  }

  const chatKey = chat.id;
  const earlier = chat.messages;
  const history = toHistory(earlier);
  const assistantId = crypto.randomUUID();
  // The backend that actually runs: an API model moves onto OpenCode while
  // MCP is on, and then keeps an OpenCode session like any OpenCode model.
  const runModelId = runModelIdFor(modelId, chatMode);
  const isOpencode = isOpencodeModel(runModelId);
  // An API key in Cowork, or in Chat with connectors or a team on, runs on Mali's own agent.
  const isMali = runsOnMaliAgent(runModelId, chatMode);
  const isCursor = isCursorModel(runModelId);
  const isCodex = isCodexModel(runModelId);
  const isAntigravity = isAntigravityModel(runModelId);
  let hasErrored = false;

  // Show the prompt right away; anything slow (MCP sync) runs after.
  const userMessage = createUserMessage(prompt, resend, attachments, context);
  updateChatMessages(chatKey, (prev) => [
    ...prev,
    userMessage,
    createAssistantPlaceholder(modelId, assistantId),
  ]);
  const runToken = startRun(chatKey, runModelId);
  if (previous) {
    await summarizeInto(chatKey, previous, runModelIdFor(modelId), budget.maxTokens);
  }

  const update = (fn: (message: ChatMessage) => ChatMessage) =>
    updateChatMessages(chatKey, (prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

  // The reply and the sidebar spinner must finish together: settle the
  // message and end the run in the same tick.
  const finish = () => {
    update((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
    endRun(chatKey, runToken);
  };

  const handleError = (content: string) => {
    if (hasErrored) return;
    hasErrored = true;
    if (shouldResetAgentSession(content)) {
      clearAgentSessions(chatKey);
    }
    const fix = fixFor(content, modelId, resend.modelName);
    updateChatMessages(chatKey, (prev) =>
      replaceAssistantWithError(prev, assistantId, content, fix),
    );
    endRun(chatKey, runToken);
    if (!fix) return;
    // A provider that was never set up: the setup dialog is what the user
    // is waiting for. A key that was there and stopped working is offered
    // on the error message instead, so a dialog never lands on top of the
    // message the user is still reading.
    if (fix.kind === "cursor-login") {
      requestCursorLogin();
      return;
    }
    if (!fix.invalid) {
      requestProviderKey({
        providerId: fix.providerId,
        target: fix.target,
        modelName: fix.modelName,
      });
    }
  };

  let checkpointId: string | undefined;
  const agentSessionId = () => {
    const current = getChat(chatKey);
    if (!current) return undefined;
    if (isOpencode) return current.opencodeSessionId;
    if (isCursor) return current.cursorSessionId;
    if (isCodex) return current.codexSessionId;
    if (isAntigravity) return current.antigravitySessionId;
    if (isMali) return current.maliSessionId;
    return undefined;
  };
  try {
    // Live-connecting MCP servers can take seconds; the reply placeholder
    // already shows the run as started meanwhile.
    // CLI agents get the connectors and Mali's document tools from its
    // `mali` gateway: hand it the connector list and this chat's folders.
    if (isOpencode || isCodex || isCursor || isAntigravity) {
      await invoke("mcp_hub_set_workspace", {
        cwd: chatMode === "cowork" ? (folders[0] ?? null) : null,
        folders: chatMode === "cowork" ? grantsFor(folders) : [],
      }).catch(() => undefined);
      if (hasEnabledMcp()) await syncMcpServers().catch(() => undefined);
    }

    // Cowork: the agent opens a skill's SKILL.md itself, so the library
    // it lives in has to be readable.
    const skillGrant = chatMode === "cowork" ? await skillsGrant() : null;

    // Cowork: save the folders the agent may change, so the turn can be undone.
    if (chatMode === "cowork") {
      checkpointId = await beginCheckpoint(writableFolders(folders));
      const id = checkpointId;
      if (id) updateRun(chatKey, (r) => ({ ...r, checkpointId: id }));
    }

    const sessionId = agentSessionId();
    await generateStream(
      {
        prompt: prompt + context,
        modelId: runModelId,
        sessionId,
        history,
        handoff: transcript(missedBy(earlier, sessionId), Math.floor(budget.maxTokens / 2)),
        mode: chatMode,
        runId: chatKey,
        cwd: folders[0],
        folders: [...grantsFor(folders), ...(skillGrant ? [skillGrant] : [])],
        attachments,
        instructions: [
          // Team mode: skills a bot owns are its duty, not the lead's.
          buildInstructions(leadInstructions(), projectContext(project), chatMode === "chat" ? "chat" : "cowork"),
          connectorInstructionsFor(),
          chatMode === "chat" ? coworkInstructionsFor(prompt) : "",
          pickedConnectorInstructions((resend.connectors ?? []).filter((id) => !ownedByTeam().connectors.has(id))),
        ]
          .filter(Boolean)
          .join("\n\n"),
        skills: calledSkills(prompt, resend.skills, [...(project?.skills ?? []), ...getInstructions().skills]),
        effort: resend.effort,
        maxTokens: budget.maxTokens,
        summary: getChat(chatKey)?.continuedFrom?.summary,
      },
      {
        onChunk: (text) => update((m) => withChunk(m, text)),
        onReasoning: (reasoning) =>
          update((m) => ({ ...m, reasoning: (m.reasoning ?? "") + reasoning })),
        onActivity: (activity) =>
          update((m) => withActivity(m, activity)),
        onTeammateProposal: (proposal) => addProposal(proposal, chatKey),
        onTodos: (items) =>
          update((m) => withTodos(m, items)),
        onMetadata: (data) => {
          if ((isOpencode || isCursor || isCodex || isAntigravity || isMali) && data.sessionId) {
            const sessionId = data.sessionId;
            updateChat(chatKey, (s) =>
              isCursor
                ? { ...s, cursorSessionId: sessionId }
                : isCodex
                  ? { ...s, codexSessionId: sessionId }
                  : isAntigravity
                    ? { ...s, antigravitySessionId: sessionId }
                    : isMali
                      ? { ...s, maliSessionId: sessionId }
                      : { ...s, opencodeSessionId: sessionId },
            );
            updateRun(chatKey, (r) => ({ ...r, agentSessionId: sessionId }));
          }
          update((m) => withMetadata(m, data));
        },
        onPermission: (request) =>
          updateRun(chatKey, (r) => ({ ...r, permissions: [...r.permissions, request] })),
        onPermissionResolved: (permissionId) =>
          updateRun(chatKey, (r) => ({
            ...r,
            permissions: r.permissions.filter((p) => p.id !== permissionId),
          })),
        onQuestion: (request) =>
          updateRun(chatKey, (r) => ({
            ...r,
            questions: [...r.questions.filter((q) => q.id !== request.id), request],
          })),
        onQuestionResolved: (questionId) =>
          updateRun(chatKey, (r) => ({
            ...r,
            questions: r.questions.filter((q) => q.id !== questionId),
          })),
        onDone: (doneModelId) => {
          update((m) => ({
            ...m,
            modelId: doneModelId || m.modelId,
            activities: m.activities?.map((a) =>
              a.done ? a : { ...a, done: true },
            ),
          }));
          finish();
        },
        // Stream errors get the same plain-language treatment as thrown ones.
        onError: (message) => handleError(formatChatError(message)),
      },
    );
  } catch (error) {
    handleError(formatChatError(error));
  } finally {
    // A reply that ended without `done` must not keep its spinner.
    finish();
  }
  if (checkpointId) {
    const changes = await finishCheckpoint(checkpointId);
    if (changes?.changes.length) {
      const turn: TurnFiles = {
        checkpointId: changes.id,
        changes: changes.changes,
        partial: changes.partial || undefined,
        state: "applied",
      };
      updateChatMessages(chatKey, (prev) => withTurn(prev, assistantId, userMessage.id, turn));
    }
  }
  return true;
}

/** Stop a chat's run, whichever backend it is on. */
export async function stopRun(chatId: string) {
  const chat = getChat(chatId);
  const activeRun = getRun(chatId);
  if (!activeRun) return;
  // Cursor, Codex and Antigravity run as child processes keyed by the chat.
  if (isCursorModel(activeRun.modelId)) return cursorAbort(chatId);
  if (isCodexModel(activeRun.modelId)) return codexAbort(chatId);
  if (isAntigravityModel(activeRun.modelId)) return antigravityAbort(chatId);
  // Mali's own agent; a plain API reply has nothing to stop and says so.
  if (apiModelOf(activeRun.modelId)) {
    await agentAbort(chatId);
    return;
  }
  if (!activeRun.agentSessionId) return;
  // Withdraw whatever the agent is still waiting on, or the stopped turn
  // leaves a question pending on the server.
  for (const question of activeRun.questions) {
    await opencodeReplyQuestion(question.id, question.directory, []).catch(() => undefined);
  }
  updateRun(chatId, (r) => ({ ...r, questions: [] }));
  await opencodeAbort({
    sessionId: activeRun.agentSessionId,
    cwd: chat?.cwd,
    mode: sessionMode(chat),
  });
}

/** Whether `stopRun` can stop a run on this model. */
export function canStopRun(modelId: string) {
  return (
    isOpencodeModel(modelId) ||
    isCursorModel(modelId) ||
    isCodexModel(modelId) ||
    isAntigravityModel(modelId) ||
    // Mali's agent (Cowork on an API key); a plain chat reply is too short to need it.
    !!apiModelOf(modelId)
  );
}

/** A permission card from Mali's own agent, rather than OpenCode. */
function isMaliRun(chatId: string) {
  const run = getRun(chatId);
  return !!run && !!apiModelOf(run.modelId);
}

export async function replyToPermission(chatId: string, request: PermissionRequest, reply: PermissionReply) {
  // A team's cards reach a CLI lead's chat too; Mali's agent says whether one is its own.
  const handled = await agentReplyPermission(request.id, reply).catch(() => false);
  if (!handled && !isMaliRun(chatId)) await opencodeReplyPermission(request.id, request.directory, reply);
  updateRun(chatId, (r) => ({
    ...r,
    permissions: r.permissions.filter((p) => p.id !== request.id),
  }));
}

/**
 * Answer the agent's question. An empty answer withdraws the question, so
 * the turn carries on instead of waiting for input that isn't coming.
 */
export async function answerAgentQuestion(chatId: string, request: QuestionRequest, answers: string[][]) {
  // Drop the card first: the agent replies straight away, and a card that
  // lingers over the reply looks like the answer didn't register.
  updateRun(chatId, (r) => ({ ...r, questions: r.questions.filter((q) => q.id !== request.id) }));
  try {
    const handled = await agentAnswerQuestion(request.id, answers).catch(() => false);
    if (!handled && !isMaliRun(chatId)) await opencodeReplyQuestion(request.id, request.directory, answers);
  } catch (error) {
    updateRun(chatId, (r) => ({ ...r, questions: [...r.questions, request] }));
    throw error;
  }
}

/**
 * Grant a folder the agent asked for, remember it on the chat, and let the
 * running prompt use it without asking again.
 */
export async function allowFolderForRun(chatId: string, request: PermissionRequest, folder: string) {
  const grant = await requestFolderAccess(folder, {
    reason: "OpenCode asked to use this folder for the current task.",
  });
  if (!grant) return replyToPermission(chatId, request, "reject");
  attachFolder(chatId, grant.path);
  // Save the folder before the agent gets to change it, so undo covers it.
  const checkpointId = getRun(chatId)?.checkpointId;
  if (checkpointId && grant.access === "write") await addCheckpointFolder(checkpointId, grant.path);
  const sessionId = getRun(chatId)?.agentSessionId;
  await opencodeReplyPermission(
    request.id,
    request.directory,
    "once",
    sessionId ? { sessionId, folder: { path: grant.path, access: grant.access } } : undefined,
  );
  updateRun(chatId, (r) => ({
    ...r,
    permissions: r.permissions.filter((p) => p.id !== request.id),
  }));
}

/**
 * The folders an agent can change: those granted read & write, and writable
 * folders granted inside read-only ones.
 */
function writableFolders(folders: string[]) {
  return grantsFor(folders)
    .filter((g) => g.access === "write" && folders.some((f) => isWithin(g.path, f)))
    .map((g) => g.path);
}

/**
 * Keep a turn's file changes on the reply that ended it: the assistant
 * message, or the error that replaced it.
 */
function withTurn(messages: ChatMessage[], assistantId: string, userId: string, turn: TurnFiles) {
  let index = messages.findIndex((m) => m.id === assistantId);
  if (index < 0) {
    const start = messages.findIndex((m) => m.id === userId);
    index = start < 0 ? -1 : messages.findIndex((m, i) => i > start && m.role !== "user");
  }
  if (index < 0) return messages;
  return messages.map((m, i) => (i === index ? { ...m, turn } : m));
}

function isAuthError(message: string) {
  return /api[ _-]?key|unauthori[sz]ed|\b401\b|authentication|credential|not signed in|log ?in|user not found|key limit exceeded/i.test(
    message,
  );
}

/**
 * What the user can do about a failed run, offered on the error message.
 * `invalid` tells the two cases apart: a key that was never entered, and one
 * that is saved but the provider turned down.
 */
function fixFor(content: string, modelId: string, modelName?: string): ErrorFix | undefined {
  if (!isAuthError(content)) return undefined;
  if (isCursorModel(modelId)) return { kind: "cursor-login" };
  // Ask for the key where it belongs: OpenCode's auth store for its models,
  // Settings → Models for a provider called over its own API.
  const opencodeProvider = opencodeProviderOf(modelId);
  if (opencodeProvider) {
    const connected = getOpencodeModels()?.providers.find((p) => p.id === opencodeProvider)?.connected;
    return { kind: "provider-key", providerId: opencodeProvider, modelName, invalid: !!connected };
  }
  const api = apiModelOf(modelId);
  if (!api) return undefined;
  const saved = !!getProviderConfig(api.provider)?.apiKey.trim();
  return { kind: "provider-key", providerId: api.provider, target: "api", modelName, invalid: saved };
}

/** Stale agent sessions after a key change cause confusing follow-up errors on retry. */
function shouldResetAgentSession(message: string) {
  return isAuthError(message) || /key limit|limit exceeded|user not found/i.test(message);
}

/** Earlier user/assistant turns, for providers that need the conversation resent. */
function toHistory(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter(
      (m): m is ChatMessage & { role: HistoryMessage["role"] } =>
        (m.role === "user" || m.role === "assistant") && !!m.content.trim(),
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content + (m.context ?? "") }));
}

/**
 * The turns an agent's own session hasn't seen: the whole chat when it starts
 * a fresh session (the user switched to it mid-chat), or whatever other
 * models said since it last replied.
 */
function missedBy(messages: ChatMessage[], sessionId: string | undefined): ChatMessage[] {
  if (!sessionId) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.sessionId === sessionId) return messages.slice(i + 1);
  }
  return messages;
}

/** Skills picked as badges first, then any still typed as `/name`. */
function calledSkills(prompt: string, picked: string[] = [], all: Skill[]): Skill[] {
  const found = picked
    .map((slug) => all.find((k) => skillSlug(k) === slug && k.instructions.trim()))
    .filter((k): k is Skill => !!k);
  for (const skill of skillsInPrompt(prompt, all)) if (!found.includes(skill)) found.push(skill);
  return found;
}

function createUserMessage(
  prompt: string,
  resend: NonNullable<ChatMessage["resend"]>,
  attachments: Attachment[],
  context: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: prompt,
    createdAt: Date.now(),
    resend,
    ...(attachments.length ? { attachments } : {}),
    ...(context ? { context } : {}),
  };
}

/**
 * Write a summary of `previous` into chat `chatKey`'s `continuedFrom`. A
 * failed summary leaves the new chat without one, as before summaries existed.
 */
export async function summarizeInto(chatKey: string, previous: ChatSession, modelId: string, maxTokens: number) {
  const settle = (summary?: string) =>
    updateChat(chatKey, (s) =>
      s.continuedFrom ? { ...s, continuedFrom: { ...s.continuedFrom, summary, summarizing: false } } : s,
    );
  try {
    // An earlier summary is part of what this chat knew.
    const earlier = previous.continuedFrom?.summary;
    const messages: ChatMessage[] = earlier
      ? [{ id: "earlier", role: "assistant", content: `Summary of an even earlier chat:\n${earlier}` }, ...previous.messages]
      : previous.messages;
    settle(
      (await summarizeConversation(messages, { modelId, runId: chatKey, maxTokens })) || undefined,
    );
  } catch {
    settle();
  }
}

function createAssistantPlaceholder(
  modelId: string,
  id: string,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    modelId,
    // The Weekly recap and Outputs place a reply in time by this.
    createdAt: Date.now(),
    isStreaming: true,
  };
}

export function createErrorMessage(content: string, fix?: ErrorFix): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "error",
    content,
    ...(fix ? { fix } : {}),
  };
}

export function formatChatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/error decoding response body|returned an empty reply|isn't json/i.test(raw)) {
    return `${raw}\n\nMali อ่านคำตอบจากเซิร์ฟเวอร์ไม่ได้ — มักเกิดจาก API key หรือ Base URL ใน Settings → Models ไม่ถูกต้อง, OpenCode ค้าง, หรือ connector ตอบกลับผิดรูปแบบ ลองปิด–เปิดแอป, ตรวจ key/URL, หรือปิด connector ทีละตัวแล้วส่งข้อความใหม่`;
  }
  if (/user not found/i.test(raw)) {
    return 'ผู้ให้บริการไม่รู้จัก API key ที่บันทึกไว้ (ตอบกลับว่า "User not found") — ใส่ key ใหม่จากปุ่มด้านล่าง แล้วแอปจะส่งข้อความเดิมให้อีกครั้ง';
  }
  if (/key limit exceeded/i.test(raw)) {
    return "API key นี้ใช้เกินวงเงินที่ตั้งไว้ — เพิ่ม limit ให้ key เดิม หรือสร้าง key ใหม่แล้วใส่จากปุ่มด้านล่าง";
  }
  // A tool schema the provider refuses. The app leaves such tools out by
  // itself now, so this only shows up on a chat that ran before it did.
  if (/recursive json schema/i.test(raw)) {
    return `${raw}\n\nเครื่องมือของ MCP server ตัวหนึ่งมี schema ที่อ้างถึงตัวเอง ซึ่งผู้ให้บริการโมเดลนี้ไม่รับ แล้วปฏิเสธทั้งคำขอ — ส่งข้อความใหม่อีกครั้ง แอปจะตัดเฉพาะเครื่องมือตัวนั้นออกให้เอง (เครื่องมืออื่นของ server เดิมยังใช้ได้ปกติ)`;
  }
  // Cursor's own wording for "my servers turned you away", after the app has
  // already tried again a couple of times.
  if (/resource_exhausted|retriableerror/i.test(raw)) {
    return `${raw}\n\nCursor ปฏิเสธคำขอชั่วคราว (resource_exhausted) — แอปลองใหม่ให้แล้วแต่ยังไม่ผ่าน มักเป็นเพราะโควตาของแพลน Cursor หมดรอบ หรือเซิร์ฟเวอร์ Cursor แน่น ลองอีกครั้งในอีกสักครู่ หรือเลือกโมเดลอื่นในแถบด้านล่างแล้วกด Retry แชทจะทำต่อจากเดิม`;
  }
  // Both of these are about the model, not the chat: picking another one in
  // the composer and pressing Retry carries the same session on.
  if (/credits|quota exceeded|insufficient[_ ]balance|billing/i.test(raw)) {
    return `${raw}\n\nโควตาของโมเดลนี้หมด — เลือกโมเดลอื่นในแถบด้านล่าง แล้วกด Retry ได้เลย งานที่ agent ทำไปแล้วยังอยู่ครบ แชทจะทำต่อจากเดิม`;
  }
  if (raw.includes("429") || raw.includes("Too Many Requests") || /rate[- ]?limit/i.test(raw)) {
    return `${raw}\n\nโมเดลนี้ถูกเรียกถี่เกินไป — รอสักครู่แล้วกด Retry หรือเลือกโมเดลอื่นในแถบด้านล่างแล้วกด Retry แชทจะทำต่อจากเดิม`;
  }
  if (raw.includes("413") || /request too large|context.length|maximum context/i.test(raw)) {
    return `${raw}\n\nแชทนี้ยาวเกินที่โมเดลรับได้ — เริ่มแชทใหม่ หรือลด Context Limit ใน Settings → Models`;
  }
  return raw;
}

function finalizeActivities(activities: ActivityItem[], incomingId?: string) {
  // A teammate's steps (`team:<bot>:<call>:…`) arrive while its hand-off is still open.
  return activities.map((a) =>
    a.done || (a.id && incomingId?.startsWith(`${a.id}:`)) ? a : { ...a, done: true },
  );
}

/**
 * Append reply text. Text that follows a step starts a new paragraph, so
 * "…then I'll rename them." and "Done: …" never run together in the copy.
 */
function withChunk(message: ChatMessage, text: string): ChatMessage {
  const last = message.activities?.at(-1);
  const content = message.content;
  const afterStep =
    last?.offset === content.length && content.trim() !== "" && !/\n\s*$/.test(content);
  return { ...message, content: content + (afterStep ? `\n\n${text.trimStart()}` : text) };
}

/** Merge a streamed activity into the message's step list. */
function withActivity(message: ChatMessage, incoming: ActivityItem): ChatMessage {
  const prev = message.activities ?? [];
  // A new step is placed where the text is now; updates keep their place.
  const activity = { ...incoming, offset: message.content.length };
  if (activity.id) {
    const index = prev.findIndex((a) => a.id === activity.id);
    if (index >= 0) {
      const activities = [...prev];
      activities[index] = { ...prev[index], ...activity, offset: prev[index].offset };
      return { ...message, activities };
    }
    return {
      ...message,
      activities: [...finalizeActivities(prev, activity.id), activity],
    };
  }
  const last = prev[prev.length - 1];
  // Same step reporting progress: update it in place.
  if (last && (last.title === activity.title || (last.kind === activity.kind && !last.done && activity.done))) {
    return {
      ...message,
      activities: [...prev.slice(0, -1), { ...last, ...activity, offset: last.offset }],
    };
  }
  return {
    ...message,
    activities: [...finalizeActivities(prev), activity],
  };
}

/** Merge streamed todo updates into the message's task plan. */
function withTodos(message: ChatMessage, items: TodoItem[]): ChatMessage {
  const MAX_TODOS = 50;
  const trimmed = items.slice(0, MAX_TODOS);
  const prev = message.todos ?? [];
  // Replace by id when available; otherwise append.
  const map = new Map<string | number, TodoItem>();
  for (const [index, item] of prev.entries()) {
    map.set(item.id ?? index, item);
  }
  for (const item of trimmed) {
    if (item.id) {
      map.set(item.id, item);
    } else {
      // Match by text for agents that don't send ids.
      const key = [...map.entries()].find(([, v]) => v.text === item.text)?.[0];
      if (key != null) map.set(key, item);
      else map.set(map.size, item);
    }
  }
  return { ...message, todos: [...map.values()].slice(0, MAX_TODOS) };
}

function withMetadata(message: ChatMessage, data: StreamMetadata): ChatMessage {
  return {
    ...message,
    sessionId: data.sessionId ?? message.sessionId,
    usage: data.usage ? { ...message.usage, ...data.usage } : message.usage,
    durationMs: data.durationMs ?? message.durationMs,
  };
}

function replaceAssistantWithError(
  messages: ChatMessage[],
  assistantId: string,
  content: string,
  fix?: ErrorFix,
) {
  const assistant = messages.find((m) => m.id === assistantId);
  const hasContext = Boolean(assistant?.content?.trim() || assistant?.reasoning?.trim() || assistant?.usage);
  if (hasContext && assistant) {
    // เก็บ thinking/usage ไว้ แล้วเพิ่ม error เป็นบับเบิลแยก (user จะเห็น reasoning/usage แม้ exit 1)
    return [
      ...messages.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)),
      createErrorMessage(content, fix),
    ];
  }
  return [
    ...messages.filter((item) => item.id !== assistantId),
    createErrorMessage(content, fix),
  ];
}
