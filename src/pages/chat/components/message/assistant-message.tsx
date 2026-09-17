"use client";

import {
    Message,
    MessageAction,
    MessageActions,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import { BotFace } from "@/components/anim/bot-face";
import {
    ChainOfThought,
    ChainOfThoughtContent,
    ChainOfThoughtItem,
    ChainOfThoughtStep,
    ChainOfThoughtTrigger,
} from "@/components/ui/chain-of-thought";
import { cn } from "@/lib/utils";
import {
    Brain,
    CheckIcon,
    CopyIcon,
    FileTextIcon,
    HammerIcon,
    LockIcon,
    SearchIcon,
    SparklesIcon,
    TerminalIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ActivityItem } from "../../types";

type Props = {
  content: string;
  reasoning?: string;
  activities?: ActivityItem[];
  modelId?: string;
  isStreaming?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    cost?: number;
  };
  sessionId?: string;
  durationMs?: number;
};

export function AssistantMessage({
  content,
  reasoning,
  activities,
  modelId,
  isStreaming,
  usage,
  sessionId,
  durationMs,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(true);

  const isCli =
    (modelId ?? "").startsWith("cli:") ||
    (modelId ?? "").startsWith("opencode:");
  const agentName = isCli ? modelId!.split(":")[1] : undefined;

  useEffect(() => {
    if (isStreaming) {
      setReasoningOpen(true);
    }
  }, [isStreaming]);

  const handleCopy = async () => {
    const text = [reasoning, content].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasReasoning = Boolean(reasoning?.trim());
  const hasContent = Boolean(content.trim());
  const hasActivities = (activities?.length ?? 0) > 0;
  const showThinking =
    isStreaming && !hasContent && !hasReasoning && !hasActivities;
  const showEmptyState =
    !isStreaming && !hasContent && !hasReasoning && !hasActivities;
  const contentIsAnimating = isCli ? false : isStreaming;

  console.log("activities", activities);

  return (
    <Message from="assistant">
      <div className="mb-2 flex items-center gap-2">
        {isStreaming && (
          <span className="text-[11px] text-muted-foreground animate-pulse">
            {isCli ? `Running ${agentName}…` : "Thinking…"}
          </span>
        )}
      </div>

      {hasActivities && (
        <ChainOfThought>
          {activities!.map((activity, idx) => {
            const hasDetail = Boolean(activity.detail?.trim());
            return (
              <ChainOfThoughtStep
                key={`${activity.kind}-${idx}-${activity.title}`}
                defaultOpen={idx === activities!.length - 1 && isStreaming}
              >
                <ChainOfThoughtTrigger
                  // disabled={!hasDetail}
                  swapIconOnHover={hasDetail}
                  leftIcon={
                    <ActivityIcon kind={activity.kind} done={activity.done} />
                  }
                >
                  <span
                    className={cn(
                      "text-xs",
                      activity.done && "text-muted-foreground line-through",
                    )}
                  >
                    {activity.title}
                  </span>
                </ChainOfThoughtTrigger>
                {hasDetail && (
                  <ChainOfThoughtContent>
                    <ChainOfThoughtItem className="whitespace-pre-wrap break-words text-[11px]">
                      {activity.detail!.length > 400
                        ? activity.detail!.slice(0, 400) + "…"
                        : activity.detail}
                    </ChainOfThoughtItem>
                  </ChainOfThoughtContent>
                )}
              </ChainOfThoughtStep>
            );
          })}
        </ChainOfThought>
      )}
      <MessageContent
        className={cn(
          "w-full max-w-none bg-transparent px-0 py-0 shadow-none mt-4",
        )}
      >
        {hasContent ? (
          <MessageResponse isAnimating={contentIsAnimating}>
            {content}
          </MessageResponse>
        ) : showThinking ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <BotFace size={48} />
            <span className="text-sm text-muted-foreground">
              {isCli ? `Waiting for ${agentName}…` : "Thinking…"}
            </span>
          </div>
        ) : showEmptyState ? (
          <div className="px-4 py-3 text-sm italic text-muted-foreground">
            No response received.
          </div>
        ) : null}
      </MessageContent>

      {(hasContent || hasReasoning) && !isStreaming && (
        <MessageActions className="mt-2">
          <MessageAction
            tooltip={copied ? "Copied" : "Copy"}
            onClick={handleCopy}
          >
            {copied ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </MessageAction>
          {(usage || sessionId || durationMs) && (
            <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
              {usage?.inputTokens != null && (
                <span>in:{usage.inputTokens}</span>
              )}
              {usage?.outputTokens != null && (
                <span>out:{usage.outputTokens}</span>
              )}
              {usage?.reasoningTokens != null && (
                <span>reason:{usage.reasoningTokens}</span>
              )}
              {usage?.totalTokens != null && (
                <span>total:{usage.totalTokens}</span>
              )}
              {usage?.cost != null && <span>${usage.cost.toFixed(4)}</span>}
              {durationMs != null && (
                <span>{(durationMs / 1000).toFixed(1)}s</span>
              )}
              {sessionId && <span>· {sessionId.slice(0, 8)}</span>}
            </span>
          )}
        </MessageActions>
      )}
    </Message>
  );
}

function ActivityIcon({ kind, done }: { kind: string; done: boolean }) {
  const size = "size-3.5";
  if (done) return <CheckIcon className={cn(size, "text-emerald-600")} />;
  switch (kind) {
    case "tool":
      return <HammerIcon className={cn(size, "text-blue-500")} />;
    case "step":
      return <TerminalIcon className={cn(size, "text-purple-500")} />;
    case "file":
      return <FileTextIcon className={cn(size, "text-emerald-500")} />;
    case "permission":
      return <LockIcon className={cn(size, "text-amber-500")} />;
    case "search":
      return <SearchIcon className={cn(size, "text-sky-500")} />;
    case "system":
      return <SparklesIcon className={cn(size, "text-slate-500")} />;
    default:
      return <Brain className={cn(size, "text-muted-foreground")} />;
  }
}
