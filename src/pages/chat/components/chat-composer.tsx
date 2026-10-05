import type { ChatSession } from "@/features/chat-history";
import {
  PermissionPrompt,
  QuestionPrompt,
  type PermissionReply,
  type WorkMode,
} from "@/features/opencode";
import { ChildTaskAlerts, useChildTaskRequests } from "@/features/tasks";
import { ProposalCard, useTeam } from "@/features/team";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { PermissionRequest, QuestionRequest } from "../api/chat";
import type { SendMessage } from "../hooks/use-chat";
import type { AiModel, ContextBudget } from "../models";
import type { ChatMessage } from "../types";
import PromptInput from "./prompt";

type Props = {
  mode: WorkMode;
  /** The chat's project, for its skills in the `/` picker. */
  projectId?: string;
  session?: ChatSession;
  messages: ChatMessage[];
  isLoading: boolean;
  canStop: boolean;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  permissions: PermissionRequest[];
  /** Questions the agent asked; the turn waits until one is answered. */
  questions: QuestionRequest[];
  placeholder?: string;
  onReplyPermission: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  onAnswerQuestion: (request: QuestionRequest, answers: string[][]) => Promise<void>;
  onAllowFolder: (request: PermissionRequest, folder: string) => Promise<void>;
  onStop: () => void;
  onNewChat: (options?: { cwd?: string }) => void;
  onSummarize?: (model: AiModel, budget: ContextBudget) => void;
  onModeChange: (mode: WorkMode) => void;
  onSubmit: (payload: SendMessage) => Promise<boolean>;
  onSubmitBackground?: (payload: SendMessage) => Promise<boolean>;
  /** Narrow column (Code mode). */
  compact?: boolean;
  temporaryChat?: boolean;
  onTemporaryChatChange?: (on: boolean) => void;
  canChangeTemporary?: boolean;
};

export function ChatComposer({
  mode,
  projectId,
  session,
  messages,
  isLoading,
  canStop,
  promptInputRef,
  permissions,
  questions,
  placeholder,
  onReplyPermission,
  onAnswerQuestion,
  onAllowFolder,
  onStop,
  onNewChat,
  onSummarize,
  onModeChange,
  onSubmit,
  onSubmitBackground,
  compact,
  temporaryChat,
  onTemporaryChatChange,
  canChangeTemporary,
}: Props) {
  const permissionRequests = permissions;
  const hasPermission = permissionRequests.length > 0;
  // A question and a permission never wait at the same time, but if they did,
  // the permission blocks the tool that would ask, so it comes first.
  const hasQuestion = !hasPermission && questions.length > 0;
  // A background task this chat started is waiting: its card comes up here,
  // but never over this chat's own (both answer to ⌘↵ / Esc).
  const childWaiting = useChildTaskRequests(session?.id).length > 0 && !hasPermission && !hasQuestion;
  const waiting = hasPermission || hasQuestion || childWaiting;
  // Team mode: bots the lead proposed in this chat, until the user decides.
  const navigate = useNavigate();
  // Bots the notebook suggested wait on a fresh chat.
  const proposals = useTeam().proposals.filter((p) =>
    session && p.chatId ? p.chatId === session.id : !!p.fromNotebook && messages.length === 0,
  );

  const replyPermission = async (request: PermissionRequest, reply: PermissionReply) => {
    await onReplyPermission(request, reply);
  };

  const allowFolder = async (request: PermissionRequest, folder: string) => {
    await onAllowFolder(request, folder);
  };

  return (
    <div className="relative w-full shrink-0">
      {hasPermission && (
        <div className="relative z-0 -mb-2.5">
          <PermissionPrompt stacked requests={permissionRequests} onReply={replyPermission} onAllowFolder={allowFolder} />
        </div>
      )}
      {hasQuestion && (
        <div className="relative z-0 -mb-2.5">
          <QuestionPrompt stacked requests={questions} onAnswer={onAnswerQuestion} />
        </div>
      )}
      {childWaiting && <ChildTaskAlerts chatId={session?.id} />}
      {!waiting && proposals.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onReview={() => navigate("/settings?tab=team")} className="bg-background" />
          ))}
        </div>
      )}
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={cn(
          "relative z-10",
          waiting && "rounded-2xl ring-1 ring-border/80 shadow-md",
          childWaiting && "ring-amber-500/40",
        )}
      >
        <PromptInput
          ref={promptInputRef}
          mode={mode}
          projectId={projectId}
          session={session}
          messages={messages}
          isLoading={isLoading}
          canStop={canStop}
          placeholder={placeholder}
          onStop={onStop}
          onNewChat={onNewChat}
          onSummarize={onSummarize}
          onModeChange={onModeChange}
          onSubmit={onSubmit}
          onSubmitBackground={onSubmitBackground}
          compact={compact}
          temporaryChat={temporaryChat}
          onTemporaryChatChange={onTemporaryChatChange}
          canChangeTemporary={canChangeTemporary}
        />
      </motion.div>
    </div>
  );
}