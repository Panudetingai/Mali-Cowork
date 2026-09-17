"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
};

export function UserMessage({ content }: Props) {
  return (
    <Message from="user" className="py-3">
      <MessageContent
        className={cn(
          "max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-5 py-3 text-primary-foreground shadow-sm",
          "whitespace-pre-wrap break-words",
        )}
      >
        {content}
      </MessageContent>
    </Message>
  );
}
