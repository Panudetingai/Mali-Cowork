"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";

type Props = {
  content: string;
};

export function ErrorMessage({ content }: Props) {
  return (
    <Message from="assistant" className="py-2">
      <MessageContent className="bg-transparent text-red-500!">
        {content}
      </MessageContent>
    </Message>
  );
}
