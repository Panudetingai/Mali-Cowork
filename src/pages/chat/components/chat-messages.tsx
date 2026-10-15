import { sessionMode, type ChatSession } from "@/features/chat-history";
import type { ChatMessage } from "@/pages/chat/types";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef } from "react";
import { extractCoworkBlock, looksLikeFileWork } from "../cowork-handoff";
import { CoworkSuggestionCard, MovedToCoworkDivider } from "./cowork-handoff-ui";
import { BotMakerCard, ReplyBots } from "./bot-maker-card";
import { CompactionCard } from "./compaction-card";
import { lastCompaction } from "../compaction";
import { ChatMessageItem } from "./message/chat-message-item";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
  /** Resend the user prompt with the given id. */
  onRetry?: (userMessageId: string) => void;
  onRate?: (messageId: string, value: "up" | "down") => void;
  /** Send an edited prompt again; everything after it is replaced. */
  onEdit?: (userMessageId: string, content: string) => void;
  session?: ChatSession;
};

export function ChatMessages({ messages, isLoading, onRetry, onRate, onEdit, session }: Props) {
  // One set of handlers for the whole list, so a finished message isn't redrawn
  // every time the reply streams: the callbacks it gets never change identity.
  const handlers = useRef({ onRetry, onRate, onEdit });
  handlers.current = { onRetry, onRate, onEdit };
  const stable = useMemo(
    () => ({
      onRetry: (id: string) => handlers.current.onRetry?.(id),
      onRate: (id: string, value: "up" | "down") => handlers.current.onRate?.(id, value),
      onEdit: (id: string, text: string) => handlers.current.onEdit?.(id, text),
    }),
    [],
  );
  const isEmpty = messages.length === 0 && !isLoading;
  // The prompt the latest exchange came from. A reply that failed part-way
  // leaves its own bubble plus an error bubble, so "the message before this
  // one" isn't always the prompt to resend.
  const retrySource =
    isLoading || !onRetry
      ? undefined
      : [...messages].reverse().find((m) => m.role === "user" && m.resend)?.id;
  if (isEmpty) return null;

  // Chat mode only, once the latest reply is done: offer to move to Cowork
  // when the model asked for it (a ```cowork block), or quietly when the
  // prompt plainly asked for file work and the model said nothing.
  const latest = messages.at(-1);
  let offer: { messageId: string; task?: string; quiet: boolean } | undefined;
  if (session && latest?.role === "assistant" && !isLoading && sessionMode(session) === "chat" && session.coworkHintDismissed !== latest.id) {
    const { suggestion } = extractCoworkBlock(latest.content);
    const asked = [...messages].reverse().find((m) => m.role === "user");
    if (suggestion) offer = { messageId: latest.id, task: suggestion.task, quiet: false };
    else if (asked && looksLikeFileWork(asked.content)) offer = { messageId: latest.id, quiet: true };
  }
  const movedAfter = session?.movedToCowork?.afterMessageId;
  // Summaries show where they were written; the latest one is what the model remembers.
  const compactions = session?.compactions ?? [];
  const current = session ? lastCompaction({ compactions, messages })?.id : undefined;

  return (
    <div className="flex w-full flex-col">
      <AnimatePresence initial={false}>
        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1;
          // Retry regenerates from here, so only the latest exchange offers it.
          const retryTarget =
            isLast && (msg.role === "assistant" || msg.role === "error") ? retrySource : undefined;
          // `/bot`'s card stands alone; a reply's bots go under its text.
          const cardOnly = !!msg.botMaker && !msg.content.trim();
          const streaming = !!msg.isStreaming && !!isLoading;
          return (
            <motion.div
              key={msg.id}
              data-message-id={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="group relative py-3 pr-2 first:pt-0 last:pb-0"
            >
              {index > 0 && (
                <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60" />
              )}
              {cardOnly && session ? (
                <BotMakerCard chatId={session.id} message={msg} />
              ) : (
              <ChatMessageItem
                message={msg}
                streaming={streaming}
                retryFrom={retryTarget}
                onRetry={onRetry ? stable.onRetry : undefined}
                onRate={onRate ? stable.onRate : undefined}
                onEdit={onEdit && !isLoading ? stable.onEdit : undefined}
                session={session}
              />
              )}
              {session && !cardOnly && msg.role === "assistant" && !streaming && (
                <ReplyBots chatId={session.id} message={msg} />
              )}
              {session && offer?.messageId === msg.id && (
                <CoworkSuggestionCard chatId={session.id} messageId={msg.id} task={offer.task} quiet={offer.quiet} />
              )}
              {compactions
                .filter((c) => c.afterMessageId === msg.id)
                .map((c) => (
                  <CompactionCard key={c.id} compaction={c} current={c.id === current} />
                ))}
              {session?.movedToCowork && movedAfter === msg.id && (
                <MovedToCoworkDivider folder={session.movedToCowork.folder} />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export type { ChatMessage } from "@/pages/chat/types";
