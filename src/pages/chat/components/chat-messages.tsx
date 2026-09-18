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
  if (isEmpty) return null;

  return (
    <div className="flex w-full max-w-3xl flex-col">
      <AnimatePresence initial={false}>
        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1;
          // Retry regenerates from here, so only the latest exchange offers it.
          const prev = isLast && index > 0 ? messages[index - 1] : undefined;
          const retryTarget =
            !isLoading && onRetry && (msg.role === "assistant" || msg.role === "error") && prev?.role === "user" && prev.resend
              ? prev.id
              : undefined;
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
