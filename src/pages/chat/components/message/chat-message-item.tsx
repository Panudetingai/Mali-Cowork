"use client";

import { FilesChanged } from "@/features/checkpoints";
import { sessionMode, type ChatSession } from "@/features/chat-history";
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
  /** The user prompt to send again from this reply. Set on the latest reply only. */
  retryFrom?: string;
  /** Shared by the whole list and given the message id, so they keep their identity while a reply streams. */
  onRetry?: (userMessageId: string) => void;
  onRate?: (messageId: string, value: "up" | "down") => void;
  /** User prompts: send the edited text again. Undefined hides the edit button. */
  onEdit?: (messageId: string, content: string) => void;
  /** Needed to build the work receipt of a Cowork turn. */
  session?: ChatSession;
};

function ChatMessageView({ message, streaming, retryFrom, onRetry, onRate, onEdit, session }: Props) {
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
      retryFrom={retryFrom}
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
}

/** The session fields a message reads. Its object is replaced on every streamed chunk, so identity alone isn't a change. */
function sameSession(a?: ChatSession, b?: ChatSession) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.projectId === b.projectId && sessionMode(a) === sessionMode(b);
}

/** Only the message being streamed redraws on each chunk; the rest of the list keeps its render. */
export const ChatMessageItem = memo(
  ChatMessageView,
  (prev, next) =>
    prev.message === next.message &&
    prev.streaming === next.streaming &&
    prev.retryFrom === next.retryFrom &&
    prev.onRetry === next.onRetry &&
    prev.onRate === next.onRate &&
    prev.onEdit === next.onEdit &&
    sameSession(prev.session, next.session),
);

type ReplyProps = Props & { onOpenReceipt?: () => void };

function Reply({ message, streaming, retryFrom, onRetry, onRate, onEdit, onOpenReceipt, session }: ReplyProps) {
  const retry = retryFrom && onRetry ? () => onRetry(retryFrom) : undefined;
  switch (message.role) {
    case "user":
      return (
        <UserMessage
          content={message.content}
          attachments={message.attachments}
          skills={message.resend?.skills}
          connectors={message.resend?.connectors}
          projectId={session?.projectId}
          onEdit={onEdit && ((text) => onEdit(message.id, text))}
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
          onRetry={retry}
          onRate={onRate && ((value) => onRate(message.id, value))}
          onOpenReceipt={onOpenReceipt}
          cowork={session ? sessionMode(session) === "cowork" : false}
        />
      );
    case "error":
      return <ErrorMessage content={message.content} onRetry={retry} fix={message.fix} />;
    default:
      return null;
  }
}
