import type { ChatMessage } from "@/pages/chat/types";
import { ChatMessageItem } from "./message/chat-message-item";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
};

export function ChatMessages({ messages, isLoading }: Props) {
  const isEmpty = messages.length === 0 && !isLoading;
  if (isEmpty) return null;

  return (
    <div className="flex w-full max-w-3xl flex-col">
      {messages.map((msg, index) => (
        <div
          key={msg.id}
          className="group relative py-3 first:pt-0 last:pb-0"
        >
          {index > 0 && (
            <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60" />
          )}
          <ChatMessageItem message={msg} />
        </div>
      ))}
    </div>
  );
}

export type { ChatMessage } from "@/pages/chat/types";
