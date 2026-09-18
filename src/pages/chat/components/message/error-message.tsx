"use client";

import { Message, MessageActions, MessageAction, MessageContent } from "@/components/ai-elements/message";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { ExpandableClamp } from "./expandable-clamp";

type Props = {
  content: string;
  /** Resend the prompt that failed. Undefined hides the button. */
  onRetry?: () => void;
};

export function ErrorMessage({ content, onRetry }: Props) {
  return (
    <Message from="assistant" className="py-3">
      <MessageContent className="w-full max-w-none rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
        <div className="flex items-start gap-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <ExpandableClamp maxHeightClass="max-h-40" className="min-w-0 flex-1">
            <div className="whitespace-pre-wrap">{content}</div>
          </ExpandableClamp>
        </div>
      </MessageContent>
      {onRetry && (
        <MessageActions className="mt-2">
          <MessageAction tooltip="Retry" onClick={onRetry}>
            <RotateCcwIcon className="size-3.5" />
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
}
