"use client";

import { FilesChanged } from "@/features/checkpoints";
import type { ChatSession } from "@/features/chat-history";
import { buildWorkReceipt, WorkReceiptDialog } from "@/features/work-receipt";
import type { ChatMessage } from "@/pages/chat/types";
import { memo, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AssistantMessage } from "./assistant-message";
import { TurnFilesLine, useCodeChat } from "./code-chat-context";
import { CompletionMoment } from "./completion-moment";
import { ErrorMessage } from "./error-message";
import { UserMessage } from "./user-message";

type Props = {
  message: ChatMessage;
  /** The chat's run is still active; the sidebar spinner uses the same state. */
  streaming?: boolean;
  /** Resend the prompt that produced this reply. Undefined hides the button. */
  onRetry?: () => void;
  onRate?: (value: "up" | "down") => void;
  /** User prompts: send the edited text again. Undefined hides the edit button. */
  onEdit?: (content: string) => void;
  /** Needed to build the work receipt of a Cowork turn. */
  session?: ChatSession;
  onOpenReceipt?: () => void;
};

export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  streaming,
  onRetry,
  onRate,
  onEdit,
  session,
}: Props) {
  const { chatId } = useParams<{ chatId: string }>();
  const code = useCodeChat();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const receipt = useMemo(
    () => (session && message.turn ? buildWorkReceipt(session, message) : undefined),
    [session, message],
  );
  const reply = (
    <Reply
      message={message}
      streaming={streaming}
      onRetry={onRetry}
      onRate={onRate}
      onEdit={onEdit}
      session={session}
      onOpenReceipt={receipt ? () => setReceiptOpen(true) : undefined}
    />
  );
  if (!message.turn || !chatId) return reply;
  return (
    <>
      {reply}
      <CompletionMoment receipt={receipt} onOpen={() => setReceiptOpen(true)} />
      {code ? (
        <TurnFilesLine turn={message.turn} onOpen={code.openFile} />
      ) : (
        <FilesChanged chatId={chatId} messageId={message.id} turn={message.turn} />
      )}
      {receipt && session && (
        <WorkReceiptDialog receipt={receipt} session={session} open={receiptOpen} onOpenChange={setReceiptOpen} />
      )}
    </>
  );
});

function Reply({ message, streaming, onRetry, onRate, onEdit, onOpenReceipt, session }: Props) {
  switch (message.role) {
    case "user":
      return (
        <UserMessage
          content={message.content}
          attachments={message.attachments}
          skills={message.resend?.skills}
          connectors={message.resend?.connectors}
          projectId={session?.projectId}
          onEdit={onEdit}
        />
      );
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
          onOpenReceipt={onOpenReceipt}
        />
      );
    case "error":
      return <ErrorMessage content={message.content} onRetry={onRetry} fix={message.fix} />;
    default:
      return null;
  }
}
