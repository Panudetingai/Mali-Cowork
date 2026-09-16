import type { ChatMessage } from "@/pages/chat/types";
import { ChatMessageItem } from "./message/chat-message-item";
import { LoadingMessage } from "./message/loading-message";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
};

/**
 * Clean container — delegates rendering to ai-element based items
 * - user: Message from="user" + MessageContent
 * - assistant: Message + MessageResponse (markdown via Streamdown)
 * - error: Message with destructive style
 */
export function ChatMessages({ messages, isLoading }: Props) {
  const isEmpty = messages.length === 0 && !isLoading;
  if (isEmpty) return null;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-1">
      {messages.map((msg) => (
        <ChatMessageItem key={msg.id} message={msg} />
      ))}
      {isLoading &&
        messages[messages.length - 1]?.role !== "assistant" && (
          <LoadingMessage />
        )}
    </div>
  );
}

export type { ChatMessage } from "@/pages/chat/types";
