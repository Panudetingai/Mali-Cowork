"use client";

import {
    ChainOfThought,
    ChainOfThoughtContent,
    ChainOfThoughtHeader,
    ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
    Message,
    MessageAction,
    MessageActions,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
    Brain,
    CheckIcon,
    CopyIcon,
    FileTextIcon,
    HammerIcon,
    LockIcon,
    RotateCcwIcon,
    SearchIcon,
    SparklesIcon,
    TerminalIcon,
    ThumbsDownIcon,
    ThumbsUpIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useScrollToBottomOfChainOfThoughtSteps } from "../../hooks/use-chat";
import type { ActivityItem } from "../../types";
import { ExpandableClamp } from "./expandable-clamp";

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
  feedback?: "up" | "down";
  /** Resend the prompt that produced this reply. Undefined hides the button. */
  onRetry?: () => void;
  onRate?: (value: "up" | "down") => void;
};

function titleSlice(title: string, maxLength: number) {
  return title.length > maxLength ? title.slice(0, maxLength) + "..." : title;
}

function activityStepIcon(kind: string, done: boolean): LucideIcon {
  if (done) return CheckIcon;
  switch (kind) {
    case "tool":
      return HammerIcon;
    case "step":
      return TerminalIcon;
    case "file":
      return FileTextIcon;
    case "permission":
      return LockIcon;
    case "search":
      return SearchIcon;
    case "system":
      return SparklesIcon;
    default:
      return Brain;
  }
}

function stepStatus(
  activity: ActivityItem,
  isActive: boolean,
  isStreaming?: boolean,
): "complete" | "active" | "pending" {
  if (activity.done) return "complete";
  if (isActive && isStreaming) return "active";
  return "pending";
}

export function AssistantMessage({
  content,
  reasoning,
  activities,
  modelId,
  isStreaming,
  usage,
  sessionId,
  durationMs,
  feedback,
  onRetry,
  onRate,
}: Props) {
  const [copied, setCopied] = useState(false);
  const id = modelId ?? "";
  const isOpencode = id.startsWith("opencode:");
  const isCli = isOpencode || id.startsWith("cli:");
  const agentName = isOpencode ? "OpenCode" : id.split(":")[1];
  const { containerRef } = useScrollToBottomOfChainOfThoughtSteps();

  const hasReasoning = Boolean(reasoning?.trim());
  const hasContent = Boolean(content.trim());
  const hasActivities = (activities?.length ?? 0) > 0;
  const showEmptyState =
    !isStreaming && !hasContent && !hasReasoning && !hasActivities;
  const contentIsAnimating = isCli ? false : isStreaming;
  const lastActivity = hasActivities ? activities![activities!.length - 1] : undefined;
  const waitingOnTool = Boolean(lastActivity && !lastActivity.done);
  const showAgentSpinner =
    isStreaming && (waitingOnTool || !hasContent);

  const [chainOpen, setChainOpen] = useState(
    () => !!isStreaming && hasActivities,
  );

  useEffect(() => {
    if (!hasActivities) return;
    if (!isStreaming && activities!.every((a) => a.done)) {
      setChainOpen(false);
      return;
    }
    if (isStreaming && activities!.some((a) => !a.done)) {
      setChainOpen(true);
    }
  }, [hasActivities, isStreaming, activities]);

  const handleCopy = async () => {
    const text = [reasoning, content].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Message from="assistant">
      {hasActivities && (
        <ChainOfThought
          className="space-y-2"
          open={chainOpen}
          onOpenChange={setChainOpen}
        >
          <ChainOfThoughtHeader className="text-xs font-medium">
            Process Steps ({activities!.length})
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <div ref={containerRef} className="flex flex-col gap-3">
            {activities!.map((activity, idx) => {
              const hasDetail = Boolean(activity.detail?.trim());
              const isActive = idx === activities!.length - 1;
              return (
                <ChainOfThoughtStep
                  key={activity.id ?? `${activity.kind}-${idx}-${activity.title}`}
                  icon={activityStepIcon(activity.kind, activity.done)}
                  label={titleSlice(activity.title, 120)}
                  status={stepStatus(activity, isActive, isStreaming)}
                >
                  {hasDetail && (
                    <div className="max-h-24 overflow-auto rounded-md border bg-muted/40 px-2 py-1.5 text-[11px]">
                      <MessageResponse className="text-[11px] leading-relaxed">
                        {activity.detail}
                      </MessageResponse>
                    </div>
                  )}
                </ChainOfThoughtStep>
              );
            })}
            </div>
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}
      <MessageContent
        className={cn(
          "w-full max-w-none bg-transparent px-0 py-0 shadow-none",
        )}
      >
        {hasContent ? (
          isStreaming && isCli && waitingOnTool ? (
            <pre className="text-sm whitespace-pre-wrap break-words">
              {content}
            </pre>
          ) : (
            <ExpandableClamp
              maxHeightClass="max-h-[min(70vh,32rem)]"
              disabled={isStreaming}
            >
              <MessageResponse className="text-sm" isAnimating={contentIsAnimating}>
                {content}
              </MessageResponse>
            </ExpandableClamp>
          )
        ) : showEmptyState ? (
          <div className="px-4 py-3 text-sm italic text-muted-foreground">
            No response received.
          </div>
        ) : null}
      </MessageContent>

      {showAgentSpinner ? (
        <div className="mb-2 flex items-center gap-2">
          <CoworkBot size={32} state="thinking" />
          <span className="text-[11px] text-muted-foreground animate-pulse">
            {isCli ? `Running ${agentName}…` : "Thinking…"}
          </span>
        </div>
      ) : (
        isStreaming && (
          <div
            role="status"
            aria-label="Writing reply"
            className="mt-2 flex h-7 items-center gap-1 text-muted-foreground"
          >
            <CoworkBot size={32} state="working" />
          </div>
        )
      )}

      {/* Copy, feedback, retry and usage only once the reply is complete. */}
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
          {onRate && (
            <>
              <MessageAction
                tooltip="Good response"
                onClick={() => onRate("up")}
              >
                <ThumbsUpIcon
                  className={cn(
                    "size-3.5",
                    feedback === "up" && "fill-emerald-500 text-emerald-500",
                  )}
                />
              </MessageAction>
              <MessageAction
                tooltip="Bad response"
                onClick={() => onRate("down")}
              >
                <ThumbsDownIcon
                  className={cn(
                    "size-3.5",
                    feedback === "down" && "fill-red-500 text-red-500",
                  )}
                />
              </MessageAction>
            </>
          )}
          {onRetry && (
            <MessageAction tooltip="Retry" onClick={onRetry}>
              <RotateCcwIcon className="size-3.5" />
            </MessageAction>
          )}
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
            </span>
          )}
        </MessageActions>
      )}
    </Message>
  );
}
