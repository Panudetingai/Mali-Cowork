"use client";

import { useChat } from "@/pages/chat/hooks/use-chat";
import { ChatComposer } from "./components/chat-composer";
import { ChatMessagePanel } from "./components/chat-message-panel";
import ChatTitle from "./components/chat-title";

export default function ChatLayout() {
  const {
    messages,
    isLoading,
    hasMessages,
    containerRef,
    promptInputRef,
    sendMessage,
  } = useChat();

  return (
    <div className="flex h-full flex-col items-center gap-6 px-4 py-6">
      {!hasMessages && <ChatTitle />}

      <ChatMessagePanel
        messages={messages}
        isLoading={isLoading}
        containerRef={containerRef}
      />

      <ChatComposer
        isLoading={isLoading}
        promptInputRef={promptInputRef}
        onSubmit={sendMessage}
      />
    </div>
  );
}
