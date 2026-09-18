import type { ChatSession } from "@/features/chat-history";
import { PermissionPrompt, type PermissionReply, type WorkMode } from "@/features/opencode";
import type { RefObject } from "react";
import type { PermissionRequest } from "../api/chat";
import type { SendMessage } from "../hooks/use-chat";
import type { ChatMessage } from "../types";
import PromptInput from "./prompt";

type Props = {
  mode: WorkMode;
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
  onModeChange: (mode: WorkMode) => void;
  onSubmit: (payload: SendMessage) => Promise<boolean>;
};

export function ChatComposer({
  mode,
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
  onModeChange,
  onSubmit,
}: Props) {
  return (
    <div className="w-full max-w-3xl shrink-0">
      <PermissionPrompt
        requests={permissions}
        onReply={onReplyPermission}
        onAllowFolder={onAllowFolder}
      />
      <PromptInput
        ref={promptInputRef}
        mode={mode}
        session={session}
        messages={messages}
        isLoading={isLoading}
        canStop={canStop}
        placeholder={placeholder}
        onStop={onStop}
        onNewChat={onNewChat}
        onModeChange={onModeChange}
        onSubmit={onSubmit}
      />
    </div>
  );
}
