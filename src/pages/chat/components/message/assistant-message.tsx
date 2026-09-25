"use client";

import {
    Message,
    MessageAction,
    MessageActions,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import { ChatRichBlocks } from "@/components/chat-blocks/chat-rich-blocks";
import { ZoomableImage } from "@/components/chat-blocks/zoomable-image";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { extractChatBlocks } from "@/features/chat-blocks";
import { cn } from "@/lib/utils";
import {
    CheckIcon,
    CopyIcon,
    ReceiptIcon,
    RotateCcwIcon,
    ThumbsDownIcon,
    ThumbsUpIcon,
} from "lucide-react";
import { useMemo, useState, type ComponentProps } from "react";
import type { TodoItem } from "../../api/chat";
import type { ActivityItem } from "../../types";
import { AgentSteps, segmentReply } from "./agent-steps";
import { AgentTaskPlan } from "./agent-task-plan";
import { extractCoworkBlock } from "../../cowork-handoff";
import { ConnectorSuggestions } from "./connector-suggestions";
import { extractConnectorBlocks } from "@/features/mcp/agent-install";
import { ExpandableClamp } from "./expandable-clamp";
import { MarkdownLink } from "./markdown-link";

const markdownExtras = {
  a: MarkdownLink,
  img: ({ src, alt, className }: ComponentProps<"img">) =>
    typeof src === "string" && src ? (
      <ZoomableImage
        src={src}
        alt={alt ?? ""}
        fitContent
        className={cn("my-2 max-w-full overflow-hidden rounded-xl border border-border/60", className)}
        imageClassName="max-h-80"
      />
    ) : null,
};

type Props = {
  content: string;
  reasoning?: string;
  activities?: ActivityItem[];
  todos?: TodoItem[];
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
  /** Cowork turns: open the work receipt. Undefined hides the button. */
  onOpenReceipt?: () => void;
};

export function AssistantMessage({
  content,
  reasoning,
  activities,
  todos,
  modelId,
  isStreaming,
  usage,
  sessionId,
  durationMs,
  feedback,
  onRetry,
  onRate,
  onOpenReceipt,
}: Props) {
  const [copied, setCopied] = useState(false);
  const id = modelId ?? "";
  const isOpencode = id.startsWith("opencode:");
  const isCli = isOpencode || id.startsWith("cli:");

  const hasReasoning = Boolean(reasoning?.trim());
  const { authActions, mediaPreviews, text: afterRichBlocks } = useMemo(
    () => extractChatBlocks(content),
    [content],
  );
  // ```connector blocks become install cards instead of code.
  // ```cowork is shown as a "Continue in Cowork" card under the thread.
  const { text: visibleContent, suggestions } = useMemo(
    () => extractConnectorBlocks(extractCoworkBlock(afterRichBlocks).text),
    [afterRichBlocks],
  );
  const hasContent = Boolean(content.trim());
  const hasActivities = (activities?.length ?? 0) > 0;
  const showEmptyState =
    !isStreaming && !hasContent && !hasReasoning && !hasActivities;
  const contentIsAnimating = isCli ? false : isStreaming;
  const lastActivity = hasActivities ? activities![activities!.length - 1] : undefined;
  const waitingOnTool = Boolean(lastActivity && !lastActivity.done);
  const showAgentSpinner =
    isStreaming && (waitingOnTool || !hasContent);
  // The step still running, if any: only the last one can be.
  const runningIndex = isStreaming && waitingOnTool ? activities!.length - 1 : undefined;

  const segments = useMemo(() => segmentReply(visibleContent, activities), [visibleContent, activities]);

  const handleCopy = async () => {
    const text = [reasoning, content].filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Message from="assistant">
      <MessageContent
        className={cn(
          "w-full max-w-none bg-transparent px-0 py-0 shadow-none",
        )}
      >
        {todos && todos.length > 0 && <AgentTaskPlan todos={todos} />}
        {segments.length > 0 ? (
          <ExpandableClamp
            maxHeightClass="max-h-full"
            disabled={isStreaming}
          >
            {/* Text and steps in the order they happened. */}
            {segments.map((segment, index) =>
              segment.type === "steps" ? (
                <AgentSteps
                  key={`steps-${segment.first}`}
                  steps={segment.steps}
                  runningIndex={
                    runningIndex === undefined ? undefined : runningIndex - segment.first
                  }
                />
              ) : (
                <MarkdownSurface key={`text-${index}`}>
                  <MessageResponse
                    className="text-sm"
                    isAnimating={contentIsAnimating && index === segments.length - 1}
                    components={markdownExtras}
                  >
                    {segment.text.trim()}
                  </MessageResponse>
                </MarkdownSurface>
              ),
            )}
          </ExpandableClamp>
        ) : showEmptyState ? (
          <div className="px-4 py-3 text-sm italic text-muted-foreground">
            No response received.
          </div>
        ) : null}
        {(authActions.length > 0 || mediaPreviews.length > 0) && (
          <ChatRichBlocks authActions={authActions} mediaPreviews={mediaPreviews} />
        )}
        {suggestions.length > 0 && <ConnectorSuggestions suggestions={suggestions} />}
      </MessageContent>

      {showAgentSpinner ? (
        <div className="mb-2 flex items-center gap-2">
          <CoworkBot size={32} state={waitingOnTool ? "tool" : "thinking"} />
          <span className="text-[11px] text-muted-foreground animate-pulse">
            {waitingOnTool
              ? lastActivity?.title || "Using a tool…"
              : isCli
                ? "Running…"
                : "Thinking…"}
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
          {onOpenReceipt && (
            <MessageAction tooltip="Work receipt" onClick={onOpenReceipt}>
              <ReceiptIcon className="size-3.5" />
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
