"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { ExpandableClamp } from "./expandable-clamp";

type Props = {
  content: string;
};

export function UserMessage({ content }: Props) {
  return (
    <Message from="user" className="py-3">
      <MessageContent
        className={cn(
          "max-w-[min(85%,100%)] rounded-2xl rounded-tr-sm bg-primary/20! text-primary-foreground! px-5 py-3",
          "wrap-break-word",
        )}
      >
        <ExpandableClamp
          maxHeightClass="max-h-48"
          className="[&_button]:text-foreground/80 [&_button:hover]:text-foreground"
        >
          <p className="whitespace-pre-wrap">{content}</p>
        </ExpandableClamp>
      </MessageContent>
    </Message>
  );
}
