"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { TriangleAlertIcon } from "lucide-react";

type Props = {
  content: string;
};

export function ErrorMessage({ content }: Props) {
  return (
    <Message from="assistant" className="py-3">
      <MessageContent className="w-full max-w-none rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
        <div className="flex items-start gap-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 whitespace-pre-wrap">{content}</div>
        </div>
      </MessageContent>
    </Message>
  );
}
