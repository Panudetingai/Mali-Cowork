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
import { cursorAbort, requestCursorLogin } from "@/features/cursor";
import {
    loadOpencodeSettings,
    opencodeAbort,
    opencodeReplyPermission,
    requestProviderKey,
    type PermissionReply,
    type WorkMode,
} from "@/features/opencode";
import { hasEnabledMcp, syncMcpServers } from "@/features/mcp";
import { findGrant, grantsFor, normalizeFolder, requestFolderAccess } from "@/features/workspace";
import type {
    HistoryMessage,
    PermissionRequest,
    StreamMetadata,
} from "@/pages/chat/api/chat";
import { generateStream, runModelIdFor } from "@/pages/chat/api/router";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { contextUsage } from "../context-usage";
import {
    isCursorModel,
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

export function useScroll({ messages, isLoading }: ScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !messages) return;

    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !messages) return;
    if (!stickRef.current && isLoading) return;

    const id = requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: isLoading ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, isLoading]);

  return containerRef;
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
};

const MAX_HISTORY = 40;
const NO_MESSAGES: ChatMessage[] = [];

/** A chat backed by the history store, so replies keep streaming while you browse other chats. */
export function useChat(chatId: string | undefined, newChatMode: WorkMode) {
  const navigate = useNavigate();
  const sessions = useChatSessions();
  const runs = useChatRuns();
  const session = chatId ? sessions.find((s) => s.id === chatId) : undefined;
  const run = chatId ? runs[chatId] : undefined;
  const messages = session?.messages ?? NO_MESSAGES;
  const isLoading = !!run;
  const mode = session ? sessionMode(session) : newChatMode;

  const containerRef = useScroll({ messages, isLoading });
  const promptInputRef = usePromptInput({ isLoading });

  /** Resolves false when the message was not sent (e.g. folder access declined). */
  const sendMessage = useCallback(
    async ({ prompt, model, budget }: SendMessage): Promise<boolean> => {
      const modelId = model.id;
      let chat = chatId ? getChat(chatId) : undefined;
      const chatMode = chat ? sessionMode(chat) : newChatMode;

      let folders: string[] = [];
      if (chatMode === "cowork") {
        const cwd = normalizeFolder(chat?.cwd || loadOpencodeSettings().cwd);
        if (!(await requestFolderAccess(cwd))) return false;
        // Attached folders the user has since revoked are left out.
        const extra = (chat?.folders ?? []).filter((f) => f !== cwd && findGrant(f));
        folders = [cwd, ...extra];
      }

      // Past the provider's budget: carry on in a fresh chat instead of failing.
      let continuedFrom: ChatSession["continuedFrom"];
      if (
        chat &&
        chat.messages.length > 0 &&
        budget.autoNewChat &&
        contextUsage(chat.messages, prompt).usedTokens > budget.maxTokens
      ) {
        continuedFrom = { id: chat.id, title: chat.title };
        chat = undefined;
      }

      if (!chat) {
        chat = createChat(prompt, { mode: chatMode, cwd: folders[0], continuedFrom });
        navigate(`/chat/${chat.id}`);
      } else if (chatMode === "cowork" && !chat.cwd) {
        updateChat(chat.id, (s) => ({ ...s, cwd: folders[0] }));
      }

      const chatKey = chat.id;
      const history = toHistory(chat.messages);
      const assistantId = crypto.randomUUID();
      // API models run through OpenCode while MCP servers are on.
      const runModelId = runModelIdFor(modelId);
      const isOpencode = isOpencodeModel(runModelId);
      const isCursor = isCursorModel(runModelId);
      let hasErrored = false;

      if (isOpencode && hasEnabledMcp()) {
        const mcpSync =
          chatMode === "chat"
            ? syncMcpServers({ cwd: normalizeFolder(loadOpencodeSettings().cwd), mode: "chat" })
            : folders[0]
              ? syncMcpServers({ cwd: folders[0] })
              : undefined;
        await mcpSync?.catch(() => undefined);
      }

      updateChatMessages(chatKey, (prev) => [
        ...prev,
        createUserMessage(prompt),
        createAssistantPlaceholder(modelId, assistantId),
      ]);
      const runToken = startRun(chatKey, runModelId);

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
          requestProviderKey({ providerId, modelName: model.name, invalid: true });
        }
      };

      try {
        await generateStream(
          {
            prompt,
            modelId: runModelId,
            sessionId: isOpencode
              ? chat.opencodeSessionId
              : isCursor
                ? chat.cursorSessionId
                : undefined,
            history,
            mode: chatMode,
            runId: chatKey,
            cwd: folders[0],
            folders: grantsFor(folders),
          },
          {
            onChunk: (text) =>
              update((m) => ({ ...m, content: m.content + text })),
            onReasoning: (reasoning) =>
              update((m) => ({ ...m, reasoning: (m.reasoning ?? "") + reasoning })),
            onActivity: (activity) =>
              update((m) => withActivity(m, activity)),
            onMetadata: (data) => {
              if ((isOpencode || isCursor) && data.sessionId) {
                const sessionId = data.sessionId;
                updateChat(chatKey, (s) =>
                  isCursor ? { ...s, cursorSessionId: sessionId } : { ...s, opencodeSessionId: sessionId },
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
      return true;
    },
    [chatId, newChatMode, navigate],
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
        allowWider: true,
      });
      if (!grant) return replyPermission(request, "reject");
      attachFolder(chatId, grant.path);
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

  const canStop = !!run && (isOpencodeModel(run.modelId) || isCursorModel(run.modelId));

  const stop = useCallback(async () => {
    if (!chatId) return;
    const chat = getChat(chatId);
    const activeRun = getRun(chatId);
    if (!activeRun) return;
    if (isCursorModel(activeRun.modelId)) {
      // Cursor runs as a child process, keyed by the chat it belongs to.
      return cursorAbort(chatId).catch(addError);
    }
    if (!activeRun.agentSessionId) return;
    await opencodeAbort({
      sessionId: activeRun.agentSessionId,
      cwd: chat?.cwd,
      mode: sessionMode(chat),
    }).catch(addError);
  }, [chatId, addError]);

  return {
    session,
    mode,
    messages,
    isLoading,
    hasMessages: messages.length > 0 || isLoading,
    containerRef,
    promptInputRef,
    sendMessage,
    permissions: run?.permissions ?? [],
    replyPermission,
    allowFolder,
    canStop,
    stop,
  };
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

function createUserMessage(prompt: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: prompt,
  };
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

/** Merge a streamed activity into the message's step list. */
function withActivity(message: ChatMessage, activity: ActivityItem): ChatMessage {
  const prev = message.activities ?? [];
  if (activity.id) {
    const index = prev.findIndex((a) => a.id === activity.id);
    if (index >= 0) {
      const activities = [...prev];
      activities[index] = { ...prev[index], ...activity };
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
      activities: [...prev.slice(0, -1), { ...last, ...activity }],
    };
  }
  return {
    ...message,
    activities: [...finalizeActivities(prev), activity],
  };
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

// scroll to bottom of chain of thought steps
export function useScrollToBottomOfChainOfThoughtSteps() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current?.scrollHeight,
      behavior: "smooth",
    });
  }, []);
  return { containerRef, scrollToBottom };
}