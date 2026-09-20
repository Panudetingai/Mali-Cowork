import type { ChatMessage } from "@/pages/chat/types";
import { AnimatePresence, motion } from "motion/react";
import { ChatMessageItem } from "./message/chat-message-item";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
  /** Resend the user prompt with the given id. */
  onRetry?: (userMessageId: string) => void;
  onRate?: (messageId: string, value: "up" | "down") => void;
};

export function ChatMessages({ messages, isLoading, onRetry, onRate }: Props) {
  const isEmpty = messages.length === 0 && !isLoading;
  // The prompt the latest exchange came from. A reply that failed part-way
  // leaves its own bubble plus an error bubble, so "the message before this
  // one" isn't always the prompt to resend.
  const retrySource =
    isLoading || !onRetry
      ? undefined
      : [...messages].reverse().find((m) => m.role === "user" && m.resend)?.id;
  if (isEmpty) return null;

  return (
    <div className="flex w-full max-w-3xl flex-col">
      <AnimatePresence initial={false}>
        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1;
          // Retry regenerates from here, so only the latest exchange offers it.
          const retryTarget =
            isLast && (msg.role === "assistant" || msg.role === "error") ? retrySource : undefined;
          const rate = onRate && msg.role === "assistant" ? onRate : undefined;
          return (
            <motion.div
              key={msg.id}
              layout="position"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="group relative py-3 first:pt-0 last:pb-0"
            >
              {index > 0 && (
                <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60" />
              )}
              <ChatMessageItem
                message={msg}
                streaming={!!msg.isStreaming && !!isLoading}
                onRetry={retryTarget && onRetry ? () => onRetry(retryTarget) : undefined}
                onRate={rate ? (v) => rate(msg.id, v) : undefined}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export type { ChatMessage } from "@/pages/chat/types";
