"use client";

import type { ChatMessage } from "@/pages/chat/types";
import { memo } from "react";
import { AssistantMessage } from "./assistant-message";
import { ErrorMessage } from "./error-message";
import { UserMessage } from "./user-message";

type Props = {
  message: ChatMessage;
  /** The chat's run is still active; the sidebar spinner uses the same state. */
  streaming?: boolean;
};

export const ChatMessageItem = memo(function ChatMessageItem({ message, streaming }: Props) {
  switch (message.role) {
    case "user":
      return <UserMessage content={message.content} />;
    case "assistant":
      return (
        <AssistantMessage
          content={message.content}
          reasoning={message.reasoning}
          activities={message.activities}
          modelId={message.modelId}
          isStreaming={streaming ?? message.isStreaming}
          usage={message.usage}
          sessionId={message.sessionId}
          durationMs={message.durationMs}
        />
      );
    case "error":
      return <ErrorMessage content={message.content} />;
    default:
      return null;
  }
});
