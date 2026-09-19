import type { ChatSession } from "@/features/chat-history";
import {
  PERMISSION_PREVIEW_ENABLED,
  PERMISSION_PREVIEW_REQUESTS,
  PermissionPrompt,
  type PermissionReply,
  type WorkMode,
} from "@/features/opencode";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { RefObject } from "react";
import type { PermissionRequest } from "../api/chat";
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
  placeholder?: string;
  onReplyPermission: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  onAllowFolder: (request: PermissionRequest, folder: string) => Promise<void>;
  onStop: () => void;
  onNewChat: (options?: { cwd?: string }) => void;
  onSummarize?: (model: AiModel, budget: ContextBudget) => void;
  onModeChange: (mode: WorkMode) => void;
  onSubmit: (payload: SendMessage) => Promise<boolean>;
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
  placeholder,
  onReplyPermission,
  onAllowFolder,
  onStop,
  onNewChat,
  onSummarize,
  onModeChange,
  onSubmit,
}: Props) {
  const permissionRequests = permissions;
  const hasPermission = permissionRequests.length > 0;

  const replyPermission = async (request: PermissionRequest, reply: PermissionReply) => {
    await onReplyPermission(request, reply);
  };

  const allowFolder = async (request: PermissionRequest, folder: string) => {
    await onAllowFolder(request, folder);
  };

  return (
    <div className="relative mx-auto w-full max-w-3xl shrink-0">
      {hasPermission && (
        <div className="relative z-0 -mb-2.5">
          <PermissionPrompt stacked requests={permissionRequests} onReply={replyPermission} onAllowFolder={allowFolder} />
        </div>
      )}
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={cn(
          "relative z-10",
          hasPermission && "rounded-2xl ring-1 ring-border/80 shadow-md",
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
        />
      </motion.div>
    </div>
  );
}