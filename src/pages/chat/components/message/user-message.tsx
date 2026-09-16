"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";

type Props = {
  content: string;
};

export function UserMessage({ content }: Props) {
  return (
    <Message from="user" className="py-2">
      <MessageContent className="whitespace-pre-wrap wrap-words bg-transparent!">
        {content}
      </MessageContent>
    </Message>
  );
}
