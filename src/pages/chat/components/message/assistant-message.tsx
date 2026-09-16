"use client";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { CopyIcon, CheckIcon } from "lucide-react";
import { useState } from "react";

type Props = {
  content: string;
  modelId?: string;
  isStreaming?: boolean;
};

export function AssistantMessage({ content, modelId, isStreaming }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Message from="assistant" className="py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">
          {modelId ?? "Assistant"}
        </span>
      </div>

      <MessageContent className="bg-transparent p-0">
        {content ? (
          <MessageResponse>{content}</MessageResponse>
        ) : isStreaming ? (
          <span className="text-sm text-muted-foreground">Thinking...</span>
        ) : null}
      </MessageContent>

      <MessageActions className="mt-2">
        <MessageAction tooltip={copied ? "Copied" : "Copy"} onClick={handleCopy}>
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </MessageAction>
      </MessageActions>
    </Message>
  );
}
