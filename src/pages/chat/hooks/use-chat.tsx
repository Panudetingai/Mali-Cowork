"use client";

import {
    createChat,
    endRun,
    getChat,
    getRun,
    sessionMode,
    startRun,
    updateChatMessages,
    useChatRuns,
    useChatSessions,
    type ChatSession,
} from "@/features/chat-history";
import type { Attachment } from "@/features/attachments";
import { tryChatInstallFromPrompt } from "@/features/install-from-chat";
import { botWordsIn } from "@/features/team";
import {
  notifyPermissionPending,
  notifyQuestionPending,
  notifyTaskDone,
} from "@/features/notifications/notify";
import { getOpencodeModels, type PermissionReply, type WorkMode } from "@/features/opencode";
import type { PermissionRequest, QuestionRequest } from "@/pages/chat/api/chat";
import { effortFor } from "@/features/effort";
import { runModelIdFor } from "@/pages/chat/api/router";
import { toast } from "@/components/ui/sonner";
import { makeBotsInChat } from "../bot-maker";
import { canCompact, compactChat } from "../compaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  allowFolderForRun,
  answerAgentQuestion,
  canStopRun,
  createErrorMessage,
  formatChatError,
  replyToPermission,
  sendTurn,
  stopRun,
  type TurnInput,
} from "../turn";
import { loadSelectedModelId, resendSettingsFor, type AiModel, type ContextBudget } from "../models";
import type { ChatMessage } from "../types";

type ScrollProps = {
  messages: ChatMessage[] | undefined;
  isLoading?: boolean;
};

/** How close to the bottom still counts as "at the bottom". */
const STICK_DISTANCE = 48;
/** Time constant of the glide toward the bottom; smaller catches up faster. */
const GLIDE_MS = 90;
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
/** A scroll this soon after a wheel, touch or key is the user's; later ones are the page settling. */
const INTENT_MS = 250;
/** Right after "Follow reply", a trackpad still coasting from the last flick isn't a new scroll up. */
const COAST_MS = 500;
/** Sent on the scroll container by anything that moves it on purpose (the scroll rail's jumps). */
export const USER_SCROLL_EVENT = "mali:user-scroll";

function snapToBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight - el.clientHeight;
}

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
  /** When following was last turned back on: see `COAST_MS`. */
  const followedAtRef = useRef(0);

  const updateAtBottom = useCallback((value: boolean) => {
    if (atBottomRef.current === value) return;
    atBottomRef.current = value;
    setAtBottom(value);
  }, []);

  /**
   * Glide to the bottom, frame by frame, until caught up. Then rest, even
   * mid-reply: a long tool call can stream nothing for minutes, and the
   * ResizeObserver below starts the glide again as soon as the reply grows.
   */
  /** Snap to the latest line while a reply streams (no easing lag). */
  const stickIfFollowing = useCallback(() => {
    if (!followRef.current || !loadingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    snapToBottom(el);
    updateAtBottom(true);
  }, [updateAtBottom]);

  const glide = useCallback(() => {
    if (loadingRef.current && followRef.current) {
      stickIfFollowing();
      return;
    }
    if (rafRef.current) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    const step = (now: number) => {
      const el = containerRef.current;
      if (!el || !followRef.current) {
        rafRef.current = 0;
        return;
      }
      if (loadingRef.current) {
        rafRef.current = 0;
        stickIfFollowing();
        return;
      }
      const target = el.scrollHeight - el.clientHeight;
      const gap = target - el.scrollTop;
      if (gap > 0.5) {
        const dt = Math.min(64, now - last);
        const move = reduced ? gap : Math.max(1, gap * (1 - Math.exp(-dt / GLIDE_MS)));
        el.scrollTop = Math.min(target, el.scrollTop + move);
      } else {
        snapToBottom(el);
        rafRef.current = 0;
        updateAtBottom(true);
        return;
      }
      last = now;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [stickIfFollowing, updateAtBottom]);

  const stopFollowing = useCallback(() => {
    followRef.current = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  /** Follow the conversation again (the button, or a new prompt). */
  const scrollToBottom = useCallback(() => {
    followRef.current = true;
    followedAtRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    updateAtBottom(true);
    const el = containerRef.current;
    if (el) snapToBottom(el);
    if (loadingRef.current) stickIfFollowing();
    else glide();
  }, [glide, stickIfFollowing, updateAtBottom]);

  useEffect(() => {
    const el = containerRef.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;

    let lastTop = el.scrollTop;
    // Only the user lets go of the reply. The page also moves on its own — a
    // reply re-rendering shorter for a frame, a step folding away — and the
    // browser then pulls scrollTop up; that must not stop following.
    let lastIntent = 0;
    let pointerHeld = false;
    const intent = () => {
      lastIntent = performance.now();
    };
    const coasting = () => performance.now() - followedAtRef.current < COAST_MS;
    const byUser = () => !coasting() && (pointerHeld || performance.now() - lastIntent < INTENT_MS);

    const onScroll = () => {
      const distance = distanceToBottom(el);
      const scrollingUp = el.scrollTop < lastTop - 1;
      const scrollingDown = el.scrollTop > lastTop + 1;

      if (scrollingUp && byUser()) stopFollowing();

      if (distance < STICK_DISTANCE) {
        // Re-attach only when the user scrolls back down to the bottom, not while leaving it.
        if (!followRef.current && scrollingDown) {
          followRef.current = true;
          glide();
        }
        updateAtBottom(followRef.current);
      } else if (!followRef.current) {
        updateAtBottom(false);
      } else if (scrollingUp && loadingRef.current) {
        // Pulled up by the page, still following: back to the latest line.
        stickIfFollowing();
      }
      lastTop = el.scrollTop;
    };
    // Let go the moment the user reaches up, before the next frame pulls back down.
    const onWheel = (event: WheelEvent) => {
      intent();
      if (event.deltaY < 0 && el.scrollTop > 0 && !coasting()) stopFollowing();
    };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      intent();
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      intent();
      if ((event.touches[0]?.clientY ?? 0) > touchY + 4) stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      intent();
      if (UP_KEYS.has(event.key)) stopFollowing();
    };
    // Dragging a text selection upward scrolls too.
    const onPointerDown = () => {
      pointerHeld = true;
    };
    const onPointerUp = () => {
      pointerHeld = false;
    };
    const onUserScroll = () => {
      stopFollowing();
      updateAtBottom(false);
    };
    const onContentChange = () => {
      if (followRef.current) {
        if (loadingRef.current) stickIfFollowing();
        else glide();
      } else {
        updateAtBottom(distanceToBottom(el) < STICK_DISTANCE);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener(USER_SCROLL_EVENT, onUserScroll);
    // The reply growing (text, steps, a picture loading) resizes `content`;
    // no MutationObserver, which on a long chat fired on every streamed token.
    const resize = new ResizeObserver(onContentChange);
    resize.observe(content);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener(USER_SCROLL_EVENT, onUserScroll);
      resize.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [glide, stickIfFollowing, stopFollowing, updateAtBottom, messages?.length]);

  const streamPulse = useMemo(() => {
    const last = messages?.at(-1);
    if (!last) return 0;
    return (
      (last.content?.length ?? 0) +
      (last.activities?.length ?? 0) +
      (last.reasoning?.length ?? 0)
    );
  }, [messages]);

  // While a reply streams, keep the view pinned when following (after layout).
  useEffect(() => {
    if (!isLoading || !followRef.current) return;
    stickIfFollowing();
    const id = requestAnimationFrame(() => stickIfFollowing());
    return () => cancelAnimationFrame(id);
  }, [isLoading, streamPulse, stickIfFollowing]);

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
  /** Hidden context for the model (e.g. `@`-mentioned files), not shown in the message. */
  context?: string;
  /** Skills picked as badges, by slug; called like `/name` in the text. */
  skills?: string[];
  /** Connectors picked as badges, by id. */
  connectors?: string[];
};

/** What the composer sends, as the send pipeline takes it (also used by the Task Inbox). */
export function turnInputFor({ prompt, model, budget, attachments, context, skills, connectors }: SendMessage): TurnInput {
  return {
    prompt,
    attachments,
    context,
    resend: {
      modelId: model.id,
      modelName: model.name,
      maxTokens: budget.maxTokens,
      autoNewChat: budget.autoNewChat,
      // Only ever a level this model listed, so a retry on another model
      // falls back to that model's own default instead of being refused.
      effort: effortFor(model.id, model.efforts),
      ...(skills?.length ? { skills } : {}),
      ...(connectors?.length ? { connectors } : {}),
    },
  };
}

const NO_MESSAGES: ChatMessage[] = [];
const NO_PERMISSIONS: PermissionRequest[] = [];

/** A chat backed by the history store, so replies keep streaming while you browse other chats. */
export function useChat(
  chatId: string | undefined,
  newChatMode: WorkMode,
  newChatProjectId?: string,
  newChatView?: ChatSession["view"],
  newChatEphemeral?: boolean,
) {
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
    (input: TurnInput): Promise<boolean> =>
      sendTurn(
        {
          chatId,
          newChatMode,
          newChatProjectId,
          newChatView,
          newChatEphemeral,
          onChatCreated: (chat, { mode: chatMode, projectId }) => {
            const modeQuery = chatMode === "cowork" ? "cowork" : "chat";
            navigate(`/chat/${chat.id}?mode=${modeQuery}${projectId ? `&project=${projectId}` : ""}`);
          },
        },
        input,
      ),
    [chatId, newChatMode, newChatProjectId, newChatView, newChatEphemeral, navigate],
  );

  /** Resolves false when the message was not sent (e.g. folder access declined). */
  const sendMessage = useCallback(
    async (payload: SendMessage): Promise<boolean> => {
      if (tryChatInstallFromPrompt(payload.prompt)) return true;
      // `/bot <what it should do>`: bots to pick from, right here in the chat.
      const botWords = botWordsIn(payload.prompt);
      if (botWords !== undefined) {
        if (!botWords) {
          toast.info("Say what the bot should do after /bot — e.g. /bot summarize the links I send in 5 points.");
          return false;
        }
        let id = chatId && getChat(chatId) ? chatId : undefined;
        if (!id) {
          const chat = createChat(botWords, {
            mode: newChatMode,
            projectId: newChatProjectId,
            view: newChatView,
            ephemeral: newChatEphemeral,
          });
          id = chat.id;
          navigate(`/chat/${chat.id}?mode=${newChatMode === "cowork" ? "cowork" : "chat"}${newChatProjectId ? `&project=${newChatProjectId}` : ""}`);
        }
        makeBotsInChat(id, botWords, payload.model.id);
        return true;
      }
      return executeSend(turnInputFor(payload));
    },
    [executeSend, chatId, newChatMode, newChatProjectId, newChatView, newChatEphemeral, navigate],
  );

  /**
   * Send a prompt the app wrote (Code mode: "fix these build errors") on the
   * model picked for this mode, or the one the chat last used.
   */
  const sendText = useCallback(
    async (prompt: string, context = ""): Promise<boolean> => {
      if (chatId && getRun(chatId)) return false;
      const chat = chatId ? getChat(chatId) : undefined;
      const chatMode = chat ? sessionMode(chat) : newChatMode;
      const last = [...(chat?.messages ?? [])].reverse().find((m) => m.role === "user" && m.resend)?.resend;
      const resend = resendSettingsFor(loadSelectedModelId(chatMode), getOpencodeModels(), chatMode) ?? last;
      if (!resend) return false;
      return executeSend({ prompt, context, resend: { ...resend, skills: undefined, connectors: undefined } });
    },
    [chatId, newChatMode, executeSend],
  );

  /**
   * Drop the user message and everything after it, then send it again on the
   * model that is selected now — switching model and pressing Retry is how a
   * chat carries on when the one it started with runs out of credits or gets
   * rate-limited. The agent session is kept, so the work so far still counts.
   * Retry is offered on the latest exchange; an edit (`editedContent`) may
   * start from any prompt. While a run is in flight nothing happens.
   */
  const retryMessage = useCallback(
    async (userMessageId: string, editedContent?: string): Promise<boolean> => {
      if (!chatId || getRun(chatId)) return false;
      const chat = getChat(chatId);
      const index = chat?.messages.findIndex((m) => m.id === userMessageId && m.role === "user") ?? -1;
      const original = index >= 0 ? chat!.messages[index] : undefined;
      if (!chat || !original) return false;
      const chatMode = sessionMode(chat);
      const picked = loadSelectedModelId(chatMode);
      // A prompt saved without its settings (e.g. from the Quick bar) runs on the picked model.
      const sent: ChatMessage["resend"] = original.resend ?? resendSettingsFor(picked, getOpencodeModels(), chatMode);
      if (!sent) return false;
      const { skills, connectors } = sent;
      const resend =
        picked === sent.modelId
          ? sent
          : { ...(resendSettingsFor(picked, getOpencodeModels(), chatMode) ?? sent), skills, connectors };
      const removed = chat.messages.slice(index);
      updateChatMessages(chatId, (prev) => prev.slice(0, index));
      const ok = await executeSend({
        prompt: editedContent?.trim() || original.content,
        resend,
        attachments: original.attachments,
        context: original.context,
      });
      // Not sent (e.g. folder access declined): put the conversation back as it was.
      if (!ok) updateChatMessages(chatId, (prev) => (prev.length === index ? [...prev, ...removed] : prev));
      return ok;
    },
    [chatId, executeSend],
  );

  /**
   * Editing a prompt sends it again as a new message: the prompt and every
   * reply after it go, and the edited text runs with the same picks,
   * attachments and model settings — like Retry, from any earlier prompt.
   */
  const editAndResend = useCallback(
    (userMessageId: string, content: string) => retryMessage(userMessageId, content),
    [retryMessage],
  );

  /**
   * Summarize the chat so far and keep going in it: the model hears the
   * summary instead of what came before, and the summary shows in the chat.
   * The chat is busy (nothing can be sent) while it's written.
   */
  const summarizeAndContinue = useCallback(
    async (model: AiModel, budget: ContextBudget) => {
      if (!chatId || getRun(chatId)) return;
      const chat = getChat(chatId);
      if (!chat || !canCompact(chat)) {
        toast("Nothing new to summarize yet.");
        return;
      }
      const modelId = runModelIdFor(model.id);
      const token = startRun(chatId, modelId);
      try {
        const done = await compactChat(chatId, modelId, budget.maxTokens);
        toast.success(`Summarized ${done.messages} message${done.messages === 1 ? "" : "s"} — keep going here`, {
          description: "The model remembers the summary. Open it in the chat to see what it kept.",
        });
      } catch (e) {
        toast.error("Couldn't summarize the chat", { description: e instanceof Error ? e.message : String(e) });
      } finally {
        endRun(chatId, token);
      }
    },
    [chatId],
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
      await replyToPermission(chatId, request, reply).catch(addError);
    },
    [chatId, addError],
  );

  const answerQuestion = useCallback(
    async (request: QuestionRequest, answers: string[][]) => {
      if (!chatId) return;
      await answerAgentQuestion(chatId, request, answers).catch(addError);
    },
    [chatId, addError],
  );

  const allowFolder = useCallback(
    async (request: PermissionRequest, folder: string) => {
      if (!chatId) return;
      await allowFolderForRun(chatId, request, folder).catch(addError);
    },
    [chatId, addError],
  );

  const canStop = !!run && canStopRun(run.modelId);

  const stop = useCallback(async () => {
    if (!chatId) return;
    await stopRun(chatId).catch(addError);
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

  // Notify when the agent is waiting on the user. On macOS the approval
  // notification carries the buttons, so an answer from outside the window
  // goes straight back to the agent through `replyPermission`.
  const permissions = run?.permissions;
  const questions = run?.questions;
  const permissionRef = useRef<PermissionRequest[]>(NO_PERMISSIONS);
  const replyRef = useRef(replyPermission);
  replyRef.current = replyPermission;
  useEffect(() => {
    const waiting = permissions ?? NO_PERMISSIONS;
    const previous = permissionRef.current;
    permissionRef.current = waiting;
    // Only a request that wasn't already on screen is worth a notification.
    if (waiting.length === 0 || waiting.length <= previous.length) return;
    void notifyPermissionPending(waiting, (request, reply) => {
      void replyRef.current(request, reply);
    });
  }, [permissions]);

  const questionCountRef = useRef(0);
  useEffect(() => {
    const count = questions?.length ?? 0;
    const previous = questionCountRef.current;
    questionCountRef.current = count;
    if (count > 0 && count > previous) {
      void notifyQuestionPending(count, questions?.[0]?.questions[0]?.question);
    }
  }, [questions]);

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
    sendText,
    retryMessage,
    editAndResend,
    rateMessage,
    summarizeAndContinue,
    permissions: permissions ?? [],
    replyPermission,
    allowFolder,
    questions: questions ?? [],
    answerQuestion,
    canStop,
    stop,
  };
}
