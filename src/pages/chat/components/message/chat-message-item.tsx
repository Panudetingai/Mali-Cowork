"use client";

import { FilesChanged } from "@/features/checkpoints";
import type { ChatMessage } from "@/pages/chat/types";
import { memo } from "react";
import { useParams } from "react-router-dom";
import { AssistantMessage } from "./assistant-message";
import { TurnFilesLine, useCodeChat } from "./code-chat-context";
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
  const { chatId } = useParams<{ chatId: string }>();
  const code = useCodeChat();
  const reply = <Reply message={message} streaming={streaming} onRetry={onRetry} onRate={onRate} />;
  if (!message.turn || !chatId) return reply;
  return (
    <>
      {reply}
      {code ? (
        <TurnFilesLine turn={message.turn} onOpen={code.openFile} />
      ) : (
        <FilesChanged chatId={chatId} messageId={message.id} turn={message.turn} />
      )}
    </>
  );
});

function Reply({ message, streaming, onRetry, onRate }: Props) {
  switch (message.role) {
    case "user":
      return <UserMessage content={message.content} attachments={message.attachments} />;
    case "assistant":
      return (
        <AssistantMessage
          content={message.content}
          reasoning={message.reasoning}
          activities={message.activities}
          todos={message.todos}
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
      return <ErrorMessage content={message.content} onRetry={onRetry} fix={message.fix} />;
    default:
      return null;
  }
}
