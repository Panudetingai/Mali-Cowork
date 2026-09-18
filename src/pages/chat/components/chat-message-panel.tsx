"use client";

import type { ChatSession } from "@/features/chat-history";
import { cn } from "cn";
import { HistoryIcon } from "lucide-react";
import type { RefObject } from "react";
import { Link } from "react-router-dom";
import type { ChatMessage } from "../types";
import { ChatMessages } from "./chat-messages";

type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  continuedFrom?: ChatSession["continuedFrom"];
  onRetry?: (userMessageId: string) => void;
  onRate?: (messageId: string, value: "up" | "down") => void;
};

export function ChatMessagePanel({
  messages,
  isLoading,
  containerRef,
  continuedFrom,
  onRetry,
  onRate,
}: Props) {
  return (
    <div className={cn("flex min-h-0 w-full max-w-3xl flex-col gap-3 flex-1", messages.length > 0 ? "flex-1" : "flex-none")}>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto scroll-hidden"
      >
        {continuedFrom && (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <HistoryIcon className="size-3.5" />
            The previous chat reached its context limit, so this one starts fresh.
            <Link
              to={`/chat/${continuedFrom.id}`}
              title={continuedFrom.title}
              className="max-w-[min(12rem,40vw)] truncate underline underline-offset-2"
            >
              {continuedFrom.title}
            </Link>
          </p>
        )}
        <ChatMessages messages={messages} isLoading={isLoading} onRetry={onRetry} onRate={onRate} />
      </div>
    </div>
  );
}
