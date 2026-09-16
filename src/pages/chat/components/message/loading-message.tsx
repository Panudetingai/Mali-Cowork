"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { BotFace } from "@/components/anim/bot-face";

export function LoadingMessage() {
  return (
    <Message from="assistant" className="py-2">
      <MessageContent className="rounded-none border-0 bg-transparent p-0 shadow-none">
        <div className="flex items-center gap-3">
          <BotFace size={48} />
        </div>
      </MessageContent>
    </Message>
  );
}
