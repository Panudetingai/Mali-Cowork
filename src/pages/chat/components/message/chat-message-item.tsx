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
  /** Resend the prompt that produced this reply. Undefined hides the button. */
  onRetry?: () => void;
  onRate?: (value: "up" | "down") => void;
};

export const ChatMessageItem = memo(function ChatMessageItem({ message, streaming, onRetry, onRate }: Props) {
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
          feedback={message.feedback}
          onRetry={onRetry}
          onRate={onRate}
        />
      );
    case "error":
      return <ErrorMessage content={message.content} onRetry={onRetry} />;
    default:
      return null;
  }
});
