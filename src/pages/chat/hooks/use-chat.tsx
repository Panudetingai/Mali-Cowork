"use client";

import {
    attachFolder,
    createChat,
    endRun,
    getChat,
    getRun,
    sessionMode,
    startRun,
    updateChat,
    updateChatMessages,
    updateRun,
    useChatRuns,
    useChatSessions,
    type ChatSession,
} from "@/features/chat-history";
import type { Attachment } from "@/features/attachments";
import {
    addCheckpointFolder,
    beginCheckpoint,
    finishCheckpoint,
    type TurnFiles,
} from "@/features/checkpoints";
import { codexAbort } from "@/features/codex";
import { cursorAbort, requestCursorLogin } from "@/features/cursor";
import { geminiAbort } from "@/features/gemini";
import { notifyPermissionPending, notifyTaskDone } from "@/features/notifications/notify";
import { connectorInstructionsFor, hasEnabledMcp, syncMcpServers } from "@/features/mcp";
import {
    loadOpencodeSettings,
    opencodeAbort,
    opencodeReplyPermission,
    requestProviderKey,
    type PermissionReply,
    type WorkMode,
} from "@/features/opencode";
import { buildInstructions, getInstructions, skillsInPrompt } from "@/features/instructions";
import { getProject, projectContext } from "@/features/projects";
import { findGrant, grantsFor, isWithin, normalizeFolder, requestFolderAccess } from "@/features/workspace";
import type {
    HistoryMessage,
    PermissionRequest,
    StreamMetadata,
    TodoItem,
} from "@/pages/chat/api/chat";
import { generateStream, runModelIdFor } from "@/pages/chat/api/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { contextUsage } from "../context-usage";
import { summarizeConversation } from "../summary";
import {
    isCodexModel,
    isCursorModel,
    isGeminiModel,
    isOpencodeModel,
    opencodeProviderOf,
    type AiModel,
    type ContextBudget,
} from "../models";
import type { ActivityItem, ChatMessage } from "../types";

type ScrollProps = {
  messages: ChatMessage[] | undefined;
  isLoading?: boolean;
};

/** How close to the bottom still counts as "at the bottom". */
const STICK_DISTANCE = 48;
/** Time constant of the glide toward the bottom; smaller catches up faster. */
const GLIDE_MS = 90;
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

function distanceToBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * Keeps the reply in view while it streams, gliding smoothly instead of
 * jumping on every chunk. Scrolling up (wheel, touch, keys, scrollbar) lets
 * go right away and shows a "jump to latest" button; scrolling back to the
 * bottom, the button, or sending a message follows again.
 */
export function useScroll({ messages, isLoading }: ScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const rafRef = useRef(0);
  const loadingRef = useRef(isLoading);
  loadingRef.current = isLoading;
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const updateAtBottom = useCallback((value: boolean) => {
    if (atBottomRef.current === value) return;
    atBottomRef.current = value;
    setAtBottom(value);
  }, []);

  /** Glide to the bottom, frame by frame, until caught up (and, while streaming, keep following). */
  const glide = useCallback(() => {
    if (rafRef.current) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    const step = (now: number) => {
      const el = containerRef.current;
      if (!el || !followRef.current) {
        rafRef.current = 0;
        return;
      }
      const target = el.scrollHeight - el.clientHeight;
      const gap = target - el.scrollTop;
      if (gap > 0.5) {
        const dt = Math.min(64, now - last);
        const move = reduced ? gap : Math.max(1, gap * (1 - Math.exp(-dt / GLIDE_MS)));
        el.scrollTop = Math.min(target, el.scrollTop + move);
      } else if (!loadingRef.current) {
        // Caught up and nothing is streaming: rest until content changes.
        rafRef.current = 0;
        updateAtBottom(true);
        return;
      }
      last = now;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [updateAtBottom]);

  const stopFollowing = useCallback(() => {
    followRef.current = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  /** Follow the conversation again (the button, or a new prompt). */
  const scrollToBottom = useCallback(() => {
    followRef.current = true;
    updateAtBottom(true);
    glide();
  }, [glide, updateAtBottom]);

  useEffect(() => {
    const el = containerRef.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;

    let lastTop = el.scrollTop;
    const onScroll = () => {
      const distance = distanceToBottom(el);
      if (distance < STICK_DISTANCE) {
        if (!followRef.current) {
          followRef.current = true;
          glide();
        }
        updateAtBottom(true);
      } else {
        // Our glide only moves down, and content shrinking at the bottom stays
        // near it; moving up away from the bottom is the user (e.g. the scrollbar).
        if (el.scrollTop < lastTop - 1) stopFollowing();
        if (!followRef.current) updateAtBottom(false);
      }
      lastTop = el.scrollTop;
    };
    // Let go the moment the user reaches up, before the next frame pulls back down.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && el.scrollTop > 0) stopFollowing();
    };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if ((event.touches[0]?.clientY ?? 0) > touchY + 4) stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (UP_KEYS.has(event.key)) stopFollowing();
    };
    const onContentChange = () => {
      if (followRef.current) glide();
      else updateAtBottom(distanceToBottom(el) < STICK_DISTANCE);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    const resize = new ResizeObserver(onContentChange);
    resize.observe(content);
    resize.observe(el);
    const mutation = new MutationObserver(onContentChange);
    mutation.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      resize.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [glide, stopFollowing, updateAtBottom]);

  // While a reply streams, keep gliding with it (markdown and steps grow in bursts).
  useEffect(() => {
    if (isLoading && followRef.current) glide();
  }, [isLoading, glide]);

  // Opening a chat lands on its latest message at once; a new prompt glides there.
  const chatKey = messages?.[0]?.id;
  const lastUserId = messages?.filter((m) => m.role === "user").at(-1)?.id;
  const openedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!lastUserId) return;
    if (openedRef.current !== chatKey) {
      openedRef.current = chatKey;
      const el = containerRef.current;
      followRef.current = true;
      if (el) el.scrollTop = el.scrollHeight;
      updateAtBottom(true);
      if (loadingRef.current) glide();
      return;
    }
    scrollToBottom();
  }, [chatKey, lastUserId, scrollToBottom, glide, updateAtBottom]);

  return { containerRef, atBottom, scrollToBottom };
}

export function usePromptInput({ isLoading }: { isLoading?: boolean }) {
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const wasLoadingRef = useRef(false);

  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = !!isLoading;

    if (!wasLoading || isLoading) return;

    const id = window.setTimeout(() => {
      promptInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(id);
  }, [isLoading]);

  return promptInputRef;
}

export type SendMessage = {
  prompt: string;
  model: AiModel;
  budget: ContextBudget;
  attachments?: Attachment[];
};

const MAX_HISTORY = 40;
const NO_MESSAGES: ChatMessage[] = [];

/** A chat backed by the history store, so replies keep streaming while you browse other chats. */
export function useChat(chatId: string | undefined, newChatMode: WorkMode, newChatProjectId?: string) {
  const navigate = useNavigate();
  const sessions = useChatSessions();
  const runs = useChatRuns();
  const session = chatId ? sessions.find((s) => s.id === chatId) : undefined;
  const run = chatId ? runs[chatId] : undefined;
  const messages = session?.messages ?? NO_MESSAGES;
  const isLoading = !!run;
  const mode = session ? sessionMode(session) : newChatMode;

  const { containerRef, atBottom, scrollToBottom } = useScroll({ messages, isLoading });
  const promptInputRef = usePromptInput({ isLoading });

  /**
   * The shared send pipeline. Both new prompts and retries run through here,
   * so a retry reproduces the original model and context budget exactly.
   */
  const executeSend = useCallback(
    async ({
      prompt,
      resend,
      attachments = [],
    }: {
      prompt: string;
      resend: NonNullable<ChatMessage["resend"]>;
      attachments?: Attachment[];
    }): Promise<boolean> => {
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
        contextUsage(chat.messages, prompt).usedTokens > budget.maxTokens
      ) {
        continuedFrom = { id: chat.id, title: chat.title, summarizing: true };
        previous = chat;
        chat = undefined;
      }

      if (!chat) {
        chat = createChat(prompt, { mode: chatMode, cwd: folders[0], continuedFrom, projectId: project?.id });
        navigate(`/chat/${chat.id}`);
      } else if (chatMode === "cowork" && !chat.cwd) {
        updateChat(chat.id, (s) => ({ ...s, cwd: folders[0] }));
      }

      const chatKey = chat.id;
      const history = toHistory(chat.messages);
      const assistantId = crypto.randomUUID();
      const isOpencode = isOpencodeModel(modelId);
      const isCursor = isCursorModel(modelId);
      const isCodex = isCodexModel(modelId);
      const isGemini = isGeminiModel(modelId);
      let hasErrored = false;

      // Show the prompt right away; anything slow (MCP sync) runs after.
      const userMessage = createUserMessage(prompt, resend, attachments);
      updateChatMessages(chatKey, (prev) => [
        ...prev,
        userMessage,
        createAssistantPlaceholder(modelId, assistantId),
      ]);
      const runToken = startRun(chatKey, runModelIdFor(modelId));
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
        updateChatMessages(chatKey, (prev) => replaceAssistantWithError(prev, assistantId, content));
        endRun(chatKey, runToken);
        if (isCursor && isAuthError(content)) {
          requestCursorLogin();
          return;
        }
        const providerId = opencodeProviderOf(modelId);
        if (providerId && isAuthError(content)) {
          requestProviderKey({ providerId, modelName: resend.modelName, invalid: true });
        }
      };

      let checkpointId: string | undefined;
      try {
        // Live-connecting MCP servers can take seconds; the reply placeholder
        // already shows the run as started meanwhile.
        if (hasEnabledMcp() && (isOpencode || isCodex)) {
          const cwd =
            chatMode === "chat"
              ? normalizeFolder(loadOpencodeSettings().cwd)
              : folders[0];
          const mcpSync = cwd
            ? syncMcpServers({
                cwd,
                mode: chatMode === "chat" ? "chat" : undefined,
                liveConnect: isOpencode,
              })
            : isCodex
              ? syncMcpServers({ liveConnect: false })
              : undefined;
          await mcpSync?.catch(() => undefined);
        }

        // Cowork: save the folders the agent may change, so the turn can be undone.
        if (chatMode === "cowork") {
          checkpointId = await beginCheckpoint(writableFolders(folders));
          const id = checkpointId;
          if (id) updateRun(chatKey, (r) => ({ ...r, checkpointId: id }));
        }

        await generateStream(
          {
            prompt,
            modelId: runModelIdFor(modelId),
            sessionId: isOpencode
              ? chat.opencodeSessionId
              : isCursor
                ? chat.cursorSessionId
                : isCodex
                  ? chat.codexSessionId
                  : isGemini
                    ? chat.geminiSessionId
                    : undefined,
            history,
            mode: chatMode,
            runId: chatKey,
            cwd: folders[0],
            folders: grantsFor(folders),
            attachments,
            instructions: [buildInstructions(undefined, projectContext(project)), connectorInstructionsFor(prompt)]
              .filter(Boolean)
              .join("\n\n"),
            skills: skillsInPrompt(prompt, [...(project?.skills ?? []), ...getInstructions().skills]),
            summary: getChat(chatKey)?.continuedFrom?.summary,
          },
          {
            onChunk: (text) => update((m) => withChunk(m, text)),
            onReasoning: (reasoning) =>
              update((m) => ({ ...m, reasoning: (m.reasoning ?? "") + reasoning })),
            onActivity: (activity) =>
              update((m) => withActivity(m, activity)),
            onTodos: (items) =>
              update((m) => withTodos(m, items)),
            onMetadata: (data) => {
              if ((isOpencode || isCursor || isCodex || isGemini) && data.sessionId) {
                const sessionId = data.sessionId;
                updateChat(chatKey, (s) =>
                  isCursor
                    ? { ...s, cursorSessionId: sessionId }
                    : isCodex
                      ? { ...s, codexSessionId: sessionId }
                      : isGemini
                        ? { ...s, geminiSessionId: sessionId }
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
            onError: handleError,
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
    },
    [chatId, newChatMode, newChatProjectId, navigate],
  );

  /** Resolves false when the message was not sent (e.g. folder access declined). */
  const sendMessage = useCallback(
    async ({ prompt, model, budget, attachments }: SendMessage): Promise<boolean> =>
      executeSend({
        prompt,
        attachments,
        resend: {
          modelId: model.id,
          modelName: model.name,
          maxTokens: budget.maxTokens,
          autoNewChat: budget.autoNewChat,
        },
      }),
    [executeSend],
  );

  /**
   * Drop the user message and everything after it, then resend it with the
   * same model and budget. Only the latest exchange can be retried while a
   * run is in flight nothing happens.
   */
  const retryMessage = useCallback(
    async (userMessageId: string): Promise<boolean> => {
      if (!chatId || getRun(chatId)) return false;
      const chat = getChat(chatId);
      const index = chat?.messages.findIndex((m) => m.id === userMessageId && m.role === "user") ?? -1;
      const original = index >= 0 ? chat!.messages[index] : undefined;
      if (!chat || !original?.resend) return false;
      updateChatMessages(chatId, (prev) => prev.slice(0, index));
      return executeSend({
        prompt: original.content,
        resend: original.resend,
        attachments: original.attachments,
      });
    },
    [chatId, executeSend],
  );

  /**
   * Start a new chat that carries a summary of this one, so a long
   * conversation can go on without its full weight.
   */
  const summarizeAndContinue = useCallback(
    async (model: AiModel, budget: ContextBudget) => {
      if (!chatId || getRun(chatId)) return;
      const chat = getChat(chatId);
      if (!chat || chat.messages.length === 0) return;
      const next = createChat(chat.title, {
        mode: sessionMode(chat),
        cwd: chat.cwd,
        projectId: chat.projectId,
        continuedFrom: { id: chat.id, title: chat.title, summarizing: true },
      });
      if (chat.folders?.length) updateChat(next.id, (s) => ({ ...s, folders: chat.folders }));
      navigate(`/chat/${next.id}`);
      const modelId = runModelIdFor(model.id);
      const token = startRun(next.id, modelId);
      try {
        await summarizeInto(next.id, chat, modelId, budget.maxTokens);
      } finally {
        endRun(next.id, token);
      }
    },
    [chatId, navigate],
  );

  /** Thumbs up/down on an assistant reply; tapping again clears it. */
  const rateMessage = useCallback(
    (messageId: string, value: "up" | "down") => {
      if (!chatId) return;
      updateChatMessages(chatId, (prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === "assistant"
            ? { ...m, feedback: m.feedback === value ? undefined : value }
            : m,
        ),
      );
    },
    [chatId],
  );

  const addError = useCallback(
    (error: unknown) => {
      if (chatId) {
        updateChatMessages(chatId, (prev) => [...prev, createErrorMessage(formatChatError(error))]);
      }
    },
    [chatId],
  );

  const replyPermission = useCallback(
    async (request: PermissionRequest, reply: PermissionReply) => {
      if (!chatId) return;
      try {
        await opencodeReplyPermission(request.id, request.directory, reply);
        updateRun(chatId, (r) => ({
          ...r,
          permissions: r.permissions.filter((p) => p.id !== request.id),
        }));
      } catch (error) {
        addError(error);
      }
    },
    [chatId, addError],
  );

  /**
   * Grant a folder the agent asked for, remember it on this chat, and let the
   * running prompt use it without asking again.
   */
  const allowFolder = useCallback(
    async (request: PermissionRequest, folder: string) => {
      if (!chatId) return;
      const grant = await requestFolderAccess(folder, {
        reason: "OpenCode asked to use this folder for the current task.",
      });
      if (!grant) return replyPermission(request, "reject");
      attachFolder(chatId, grant.path);
      // Save the folder before the agent gets to change it, so undo covers it.
      const checkpointId = getRun(chatId)?.checkpointId;
      if (checkpointId && grant.access === "write") await addCheckpointFolder(checkpointId, grant.path);
      const sessionId = getRun(chatId)?.agentSessionId;
      try {
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
      } catch (error) {
        addError(error);
      }
    },
    [chatId, replyPermission, addError],
  );

  const canStop =
    !!run &&
    (isOpencodeModel(run.modelId) ||
      isCursorModel(run.modelId) ||
      isCodexModel(run.modelId) ||
      isGeminiModel(run.modelId));

  const stop = useCallback(async () => {
    if (!chatId) return;
    const chat = getChat(chatId);
    const activeRun = getRun(chatId);
    if (!activeRun) return;
    if (isCursorModel(activeRun.modelId)) {
      // Cursor runs as a child process, keyed by the chat it belongs to.
      return cursorAbort(chatId).catch(addError);
    }
    if (isCodexModel(activeRun.modelId)) {
      // Same pattern as cursor: child process keyed by chat.
      return codexAbort(chatId).catch(addError);
    }
    if (isGeminiModel(activeRun.modelId)) {
      // Same pattern: child process keyed by chat.
      return geminiAbort(chatId).catch(addError);
    }
    if (!activeRun.agentSessionId) return;
    await opencodeAbort({
      sessionId: activeRun.agentSessionId,
      cwd: chat?.cwd,
      mode: sessionMode(chat),
    }).catch(addError);
  }, [chatId, addError]);

  // Notify when a Cowork task finishes while the app is in the background.
  const wasLoadingRef = useRef(isLoading);
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;
    if (wasLoading && !isLoading && session && messages.length > 0) {
      void notifyTaskDone(session.title);
    }
  }, [isLoading, session, messages.length]);

  // Notify when a permission request is waiting for the user.
  const permissionCountRef = useRef(run?.permissions.length ?? 0);
  useEffect(() => {
    const count = run?.permissions.length ?? 0;
    const previous = permissionCountRef.current;
    permissionCountRef.current = count;
    if (count > 0 && count > previous) {
      void notifyPermissionPending(count);
    }
  }, [run?.permissions.length]);

  return {
    session,
    mode,
    messages,
    isLoading,
    hasMessages: messages.length > 0 || isLoading,
    containerRef,
    atBottom,
    scrollToBottom,
    promptInputRef,
    sendMessage,
    retryMessage,
    rateMessage,
    summarizeAndContinue,
    permissions: run?.permissions ?? [],
    replyPermission,
    allowFolder,
    canStop,
    stop,
  };
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
  return /api[ _-]?key|unauthori[sz]ed|\b401\b|authentication|credential|not signed in|log ?in/i.test(
    message,
  );
}

/** Earlier user/assistant turns, for providers that need the conversation resent. */
function toHistory(messages: ChatMessage[]): HistoryMessage[] {
  return messages
    .filter(
      (m): m is ChatMessage & { role: HistoryMessage["role"] } =>
        (m.role === "user" || m.role === "assistant") && !!m.content.trim(),
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
}

function createUserMessage(
  prompt: string,
  resend: NonNullable<ChatMessage["resend"]>,
  attachments: Attachment[],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: prompt,
    resend,
    ...(attachments.length ? { attachments } : {}),
  };
}

/**
 * Write a summary of `previous` into chat `chatKey`'s `continuedFrom`. A
 * failed summary leaves the new chat without one, as before summaries existed.
 */
async function summarizeInto(chatKey: string, previous: ChatSession, modelId: string, maxTokens: number) {
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
    isStreaming: true,
  };
}

function createErrorMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "error",
    content,
  };
}

function formatChatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("429") || raw.includes("Too Many Requests")) {
    return "429 Too Many Requests — โมเดลนี้ถูกเรียกถี่เกินไป ลองรอสักครู่แล้วส่งใหม่ หรือสลับโมเดล";
  }
  if (raw.includes("413") || /request too large|context.length|maximum context/i.test(raw)) {
    return `${raw}\n\nแชทนี้ยาวเกินที่โมเดลรับได้ — เริ่มแชทใหม่ หรือลด Context Limit ใน Settings → Models`;
  }
  return raw;
}

function finalizeActivities(activities: ActivityItem[]) {
  return activities.map((a) => (a.done ? a : { ...a, done: true }));
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
      activities: [...finalizeActivities(prev), activity],
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
) {
  const assistant = messages.find((m) => m.id === assistantId);
  const hasContext = Boolean(assistant?.content?.trim() || assistant?.reasoning?.trim() || assistant?.usage);
  if (hasContext && assistant) {
    // เก็บ thinking/usage ไว้ แล้วเพิ่ม error เป็นบับเบิลแยก (user จะเห็น reasoning/usage แม้ exit 1)
    return [
      ...messages.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)),
      createErrorMessage(content),
    ];
  }
  return [
    ...messages.filter((item) => item.id !== assistantId),
    createErrorMessage(content),
  ];
}
