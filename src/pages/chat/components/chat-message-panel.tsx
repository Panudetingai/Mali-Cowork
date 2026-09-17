"use client";

import type { RefObject } from "react";
import type { ChatMessage } from "../types";
import { ChatMessages } from "./chat-messages";

type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
};

export function ChatMessagePanel({
  messages,
  isLoading,
  containerRef,
}: Props) {
  return (
    <div
      ref={containerRef}
      className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-auto scroll-hidden"
    >
      <ChatMessages messages={messages} isLoading={isLoading} />
    </div>
  );
}
