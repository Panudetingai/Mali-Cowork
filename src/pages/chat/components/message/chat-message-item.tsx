"use client";

import type { ChatMessage } from "@/pages/chat/types";
import { AssistantMessage } from "./assistant-message";
import { ErrorMessage } from "./error-message";
import { UserMessage } from "./user-message";

type Props = {
  message: ChatMessage;
};

export function ChatMessageItem({ message }: Props) {
  switch (message.role) {
    case "user":
      return <UserMessage content={message.content} />;
    case "assistant":
      return (
        <AssistantMessage
          content={message.content}
          modelId={message.modelId}
          isStreaming={message.isStreaming}
        />
      );
    case "error":
      return <ErrorMessage content={message.content} />;
    default:
      return null;
  }
}
