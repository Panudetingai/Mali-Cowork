"use client";

import { createChat } from "@/features/chat-history";
import { FolderAccessDialog, folderName, normalizeFolder } from "@/features/workspace";
import { CursorLoginDialog } from "@/features/cursor";
import { ProviderKeyDialog } from "@/features/opencode";
import { useChat } from "@/pages/chat/hooks/use-chat";
import { startTransition } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChatComposer } from "./components/chat-composer";
import { ChatMessagePanel } from "./components/chat-message-panel";
import ChatTitle from "./components/chat-title";
import { loadWorkMode, saveWorkMode, type WorkMode } from "./components/work-mode-toggle";

export default function ChatLayout() {
  const { chatId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requested = params.get("mode");
  const newChatMode: WorkMode =
    requested === "cowork" || requested === "chat" ? requested : loadWorkMode();

  const {
    session,
    mode,
    messages,
    isLoading,
    hasMessages,
    containerRef,
    promptInputRef,
    sendMessage,
    permissions,
    replyPermission,
    allowFolder,
    canStop,
    stop,
  } = useChat(chatId, newChatMode);

  // A chat keeps its type; switching starts a new chat of the other type.
  const changeMode = (next: WorkMode) => {
    if (next === mode) return;
    saveWorkMode(next);
    startTransition(() => navigate(`/?mode=${next}`, { replace: !chatId }));
  };
  const startNewChat = (options?: { cwd?: string }) => {
    if (options?.cwd && mode === "cowork") {
      const path = normalizeFolder(options.cwd);
      const chat = createChat(folderName(path), { mode: "cowork", cwd: path });
      navigate(`/chat/${chat.id}?mode=cowork`);
      return;
    }
    navigate(`/?mode=${mode}`);
  };

  // A deleted or unknown chat falls back to a new one.
  if (chatId && !session) return <Navigate to={`/?mode=${newChatMode}`} replace />;

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-4 px-4 py-4 sm:gap-5 sm:py-5">
      {!hasMessages && <ChatTitle mode={mode} />}

      <ChatMessagePanel
        messages={messages}
        isLoading={isLoading}
        containerRef={containerRef}
        continuedFrom={session?.continuedFrom}
      />

      <ChatComposer
        key={`${chatId ?? "new"}:${mode}`}
        mode={mode}
        session={session}
        messages={messages}
        isLoading={isLoading}
        canStop={canStop}
        promptInputRef={promptInputRef}
        permissions={permissions}
        placeholder={hasMessages ? "Ask a follow-up" : undefined}
        onReplyPermission={replyPermission}
        onAllowFolder={allowFolder}
        onStop={stop}
        onNewChat={startNewChat}
        onModeChange={changeMode}
        onSubmit={sendMessage}
      />

      <ProviderKeyDialog />
      <CursorLoginDialog />
      <FolderAccessDialog />
    </div>
  );
}
