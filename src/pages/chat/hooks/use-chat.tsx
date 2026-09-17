"use client";

import { generateStream } from "@/pages/chat/api/router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityItem, ChatMessage } from "../types";

type ScrollProps = {
  messages: ChatMessage[] | undefined;
};

export function useScroll({ messages }: ScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !messages) return;
    containerRef.current.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

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

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useScroll({ messages });
  const promptInputRef = usePromptInput({ isLoading });

  const sendMessage = useCallback(
    async ({ prompt, modelId }: { prompt: string; modelId: string }) => {
      const userMessage = createUserMessage(prompt);
      const assistantId = crypto.randomUUID();
      let hasErrored = false;

      setMessages((prev) => [
        ...prev,
        userMessage,
        createAssistantPlaceholder(modelId, assistantId),
      ]);
      setIsLoading(true);

      const handleError = (content: string) => {
        if (hasErrored) return;
        hasErrored = true;
        setMessages((prev) =>
          replaceAssistantWithError(prev, assistantId, content),
        );
      };

      try {
        await generateStream(
          { prompt, modelId },
          {
            onChunk: (text) => {
              setMessages((prev) => appendChunk(prev, assistantId, text));
            },
            onReasoning: (reasoning) => {
              setMessages((prev) =>
                appendReasoning(prev, assistantId, reasoning),
              );
            },
            onActivity: (activity) => {
              setMessages((prev) =>
                appendActivity(prev, assistantId, activity),
              );
            },
            onMetadata: (data) => {
              setMessages((prev) =>
                appendMetadata(prev, assistantId, data),
              );
            },
            onDone: (doneModelId) => {
              setMessages((prev) =>
                finishAssistant(prev, assistantId, doneModelId),
              );
            },
            onError: handleError,
          },
        );
      } catch (error) {
        handleError(formatChatError(error));
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    messages,
    isLoading,
    hasMessages: messages.length > 0 || isLoading,
    containerRef,
    promptInputRef,
    sendMessage,
  };
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
  return raw;
}

function appendChunk(
  messages: ChatMessage[],
  assistantId: string,
  text: string,
) {
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, content: message.content + text }
      : message,
  );
}

function appendReasoning(
  messages: ChatMessage[],
  assistantId: string,
  reasoning: string,
) {
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, reasoning: (message.reasoning ?? "") + reasoning }
      : message,
  );
}

function appendActivity(
  messages: ChatMessage[],
  assistantId: string,
  activity: ActivityItem,
) {
  return messages.map((message) => {
    if (message.id !== assistantId) return message;
    const prev = message.activities ?? [];
    // ถ้าเป็น kind เดียวกันและยังไม่ done ให้ replace ตัวล่าสุดแทนที่ append ใหม่ทุกครั้ง
    const last = prev[prev.length - 1];
    if (last && last.kind === activity.kind && !last.done && activity.done) {
      return {
        ...message,
        activities: [...prev.slice(0, -1), { ...last, done: true }],
      };
    }
    // ถือว่าเป็น step ใหม่ถ้าชื่อต่างกัน หรือ step ก่อนหน้า done แล้ว
    if (last && last.title === activity.title) {
      return {
        ...message,
        activities: [...prev.slice(0, -1), { ...last, ...activity }],
      };
    }
    return { ...message, activities: [...prev, activity] };
  });
}

function appendMetadata(
  messages: ChatMessage[],
  assistantId: string,
  data: { sessionId?: string; usage?: import("../types").AgentUsage; durationMs?: number; model?: string },
) {
  return messages.map((message) =>
    message.id === assistantId
      ? {
          ...message,
          sessionId: data.sessionId ?? message.sessionId,
          usage: data.usage ? { ...(message.usage ?? {}), ...data.usage } : message.usage,
          durationMs: data.durationMs ?? message.durationMs,
          modelId: data.model ?? message.modelId,
        }
      : message,
  );
}

function finishAssistant(
  messages: ChatMessage[],
  assistantId: string,
  modelId: string,
) {
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, modelId, isStreaming: false }
      : message,
  );
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
