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
import { useEffect, useState, type ReactNode } from "react";
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
};


function titleSlice(title: string, maxLength: number) {
  return title.length > maxLength ? title.slice(0, maxLength) + "..." : title;
}

/** Collapsible step that opens while active and closes when the step completes. */
function ActivityChainStep({
  activity,
  isActive,
  isStreaming,
  children,
}: {
  activity: ActivityItem;
  isActive: boolean;
  isStreaming?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(
    () => !activity.done && isActive && !!isStreaming,
  );

  useEffect(() => {
    if (activity.done) {
      setOpen(false);
      return;
    }
    if (isActive && isStreaming) {
      setOpen(true);
    }
  }, [activity.done, isActive, isStreaming]);

  return (
    <ChainOfThoughtStep open={open} onOpenChange={setOpen}>
      {children}
    </ChainOfThoughtStep>
  );
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
}: Props) {
  const [copied, setCopied] = useState(false);
  const id = modelId ?? "";
  const isOpencode = id.startsWith("opencode:");
  const isCli = isOpencode || id.startsWith("cli:");
  const agentName = isOpencode ? "OpenCode" : id.split(":")[1];
  const { containerRef } = useScrollToBottomOfChainOfThoughtSteps();
  const handleCopy = async () => {
    const text = [reasoning, content].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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

  return (
    <Message from="assistant">
      {hasActivities && (
        <ChainOfThought>
          {activities!.map((activity, idx) => {
            const hasDetail = Boolean(activity.detail?.trim());
            return (
              <ActivityChainStep
                key={activity.id ?? `${activity.kind}-${idx}-${activity.title}`}
                activity={activity}
                isActive={idx === activities!.length - 1}
                isStreaming={isStreaming}
              >
                <ChainOfThoughtTrigger
                  swapIconOnHover={hasDetail}
                  leftIcon={
                    <ActivityIcon kind={activity.kind} done={activity.done} />
                  }
                >
                  <span
                    className={cn(
                      "text-xs",
                      activity.done && "text-muted-foreground",
                    )}
                  >
                    {titleSlice(activity.title, 120)}
                  </span>
                </ChainOfThoughtTrigger>
                {hasDetail && (
                  <ChainOfThoughtContent>
                    <ChainOfThoughtItem ref={containerRef} className="whitespace-pre-wrap text-[11px] max-h-24 overflow-auto scroll-hidden">
                      <MessageResponse>{activity.detail}</MessageResponse>
                    </ChainOfThoughtItem>
                  </ChainOfThoughtContent>
                )}
              </ActivityChainStep>
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
          isStreaming && isCli && waitingOnTool ? (
            <pre className="text-sm whitespace-pre-wrap break-words">
              {content}
            </pre>
          ) : (
            <ExpandableClamp
              maxHeightClass="max-h-[min(70vh,32rem)]"
              disabled={isStreaming}
            >
              <MessageResponse
                className="text-sm"
                isAnimating={contentIsAnimating}
              >
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

      {showAgentSpinner && (
        <div className="mb-2 flex items-center gap-2">
          <BotFace size={32} />
          <span className="text-[11px] text-muted-foreground animate-pulse">
            {isCli ? `Running ${agentName}…` : "Thinking…"}
          </span>
        </div>
      )}

      {(hasContent || hasReasoning) && (!isStreaming || !showAgentSpinner) && (
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
