"use client";

import {
    Message,
    MessageAction,
    MessageActions,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import { ChatRichBlocks } from "@/components/chat-blocks/chat-rich-blocks";
import { SocialLinkCards } from "@/components/chat-blocks/social-link-cards";
import { ZoomableImage } from "@/components/chat-blocks/zoomable-image";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { extractChatBlocks } from "@/features/chat-blocks";
import { useToastError } from "@/components/ui/sonner";
import { speak, speakerLevel, speakerState, stopSpeaking, subscribeSpeaker, Waveform } from "@/features/voice";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    CheckIcon,
    ClockIcon,
    CopyIcon,
    LoaderIcon,
    ReceiptIcon,
    RotateCcwIcon,
    ThumbsDownIcon,
    ThumbsUpIcon,
    Volume2Icon,
    ZapIcon,
} from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore, type ComponentProps } from "react";
import type { TodoItem } from "../../api/chat";
import type { ActivityItem, AgentUsage } from "../../types";
import { AgentSteps, segmentReply } from "./agent-steps";
import { AgentTaskPlan } from "./agent-task-plan";
import { extractCoworkBlock } from "../../cowork-handoff";
import { ConnectorSuggestions } from "./connector-suggestions";
import { extractConnectorBlocks } from "@/features/mcp/agent-install";
import { extractBotBlocks } from "@/features/team/bot-blocks";
import { ExpandableClamp } from "./expandable-clamp";
import { MarkdownLink } from "./markdown-link";
import { ReplyStatus } from "./reply-status";

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
  usage?: AgentUsage;
  sessionId?: string;
  durationMs?: number;
  feedback?: "up" | "down";
  /** Resend the prompt that produced this reply. Undefined hides the button. */
  onRetry?: () => void;
  onRate?: (value: "up" | "down") => void;
  /** Cowork turns: open the work receipt. Undefined hides the button. */
  onOpenReceipt?: () => void;
  /** Cowork sessions show token/time badges; plain Chat hides them. */
  cowork?: boolean;
};

export function AssistantMessage({
  content,
  reasoning,
  activities,
  todos,
  modelId,
  isStreaming,
  usage,
  durationMs,
  feedback,
  onRetry,
  onRate,
  onOpenReceipt,
  cowork,
}: Props) {
  const [copied, setCopied] = useState(false);
  const id = modelId ?? "";
  const isOpencode = id.startsWith("opencode:");
  const isCli = isOpencode || id.startsWith("cli:");

  const hasReasoning = Boolean(reasoning?.trim());
  const { authActions, mediaPreviews, galleries, text: afterRichBlocks } = useMemo(
    () => extractChatBlocks(content),
    [content],
  );
  // ```connector blocks become install cards instead of code.
  // ```cowork is shown as a "Continue in Cowork" card under the thread.
  // ```bot blocks become the bot card under the reply (see `ChatMessages`).
  const { text: visibleContent, suggestions } = useMemo(
    () => extractConnectorBlocks(extractBotBlocks(extractCoworkBlock(afterRichBlocks).text).text),
    [afterRichBlocks],
  );
  const hasContent = Boolean(content.trim());
  const hasActivities = (activities?.length ?? 0) > 0;
  const showEmptyState =
    !isStreaming && !hasContent && !hasReasoning && !hasActivities;
  const contentIsAnimating = isCli ? false : isStreaming;
  const lastActivity = hasActivities ? activities![activities!.length - 1] : undefined;
  const waitingOnTool = Boolean(lastActivity && !lastActivity.done);
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
        {(authActions.length > 0 || mediaPreviews.length > 0 || galleries.length > 0) && (
          <ChatRichBlocks authActions={authActions} mediaPreviews={mediaPreviews} galleries={galleries} />
        )}
        {/* Posts and videos it linked to, unfurled once the reply is done. */}
        {!isStreaming && <SocialLinkCards text={visibleContent} className="mt-3" />}
        {suggestions.length > 0 && <ConnectorSuggestions suggestions={suggestions} />}
      </MessageContent>

      {isStreaming &&
        (waitingOnTool ? (
          <div className="mb-2 flex items-center gap-2">
            <CoworkBot size={32} state="tool" />
            <span className="text-[11px] text-muted-foreground animate-pulse">
              {lastActivity?.title || "Using a tool…"}
            </span>
          </div>
        ) : (
          <ReplyStatus
            growth={content.length + (activities?.length ?? 0)}
            reasoning={reasoning}
            hasContent={hasContent}
            cli={isCli}
          />
        ))}

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
          {hasContent && <ListenAction text={afterRichBlocks} />}
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
          {cowork && <ReplyUsageMeta usage={usage} durationMs={durationMs} />}
        </MessageActions>
      )}
    </Message>
  );
}

type UsageShape = NonNullable<Props["usage"]>;

const compactTokens = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const exactTokens = new Intl.NumberFormat("en-US");

function tokenTotal(usage?: UsageShape) {
  if (!usage) return undefined;
  if (usage.totalTokens != null && usage.totalTokens > 0) return usage.totalTokens;
  const sum =
    (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0) + (usage.cacheReadTokens ?? 0);
  return sum > 0 ? sum : undefined;
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function formatCost(cost: number) {
  if (cost <= 0) return undefined;
  const tiny = cost < 0.01;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: tiny ? 2 : 2,
    maximumFractionDigits: tiny ? 4 : 2,
  }).format(cost);
}

/** Token and time for a finished Cowork reply. */
function ReplyUsageMeta({ usage, durationMs }: { usage?: UsageShape; durationMs?: number }) {
  const total = tokenTotal(usage);
  const costText = usage?.cost != null ? formatCost(usage.cost) : undefined;
  const hasAnything = total != null || durationMs != null || costText;

  if (!hasAnything) return null;

  const tokenLabel =
    total != null
      ? total >= 10_000
        ? `${compactTokens.format(total)} tokens`
        : `${exactTokens.format(total)} tokens`
      : undefined;

  const detail = [
    usage?.inputTokens != null && `Read ${exactTokens.format(usage.inputTokens)}`,
    usage?.outputTokens != null && `Wrote ${exactTokens.format(usage.outputTokens)}`,
    usage?.reasoningTokens != null && `Thought ${exactTokens.format(usage.reasoningTokens)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const badgeClass = "h-5 gap-1 px-2 text-[10px] font-normal tabular-nums text-muted-foreground";

  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1" title={detail || undefined}>
      {tokenLabel && (
        <Badge variant="secondary" className={badgeClass}>
          <ZapIcon className="size-3 opacity-70" aria-hidden />
          {tokenLabel}
        </Badge>
      )}
      {durationMs != null && (
        <Badge variant="outline" className={badgeClass}>
          <ClockIcon className="size-3 opacity-70" aria-hidden />
          {formatDuration(durationMs)}
        </Badge>
      )}
      {costText && (
        <Badge variant="outline" className={badgeClass}>
          {costText}
        </Badge>
      )}
    </span>
  );
}

/** Read the reply aloud in the voice from Settings → Voice; again to stop. */
function ListenAction({ text }: { text: string }) {
  const id = useId();
  const state = useSyncExternalStore(subscribeSpeaker, speakerState);
  const mine = state.id === id;
  const loading = mine && state.loading;
  const speaking = mine && state.speaking;
  useToastError(mine && state.error ? state.error : undefined);
  return (
    <MessageAction
      tooltip={speaking ? "Stop reading" : loading ? "Getting the voice ready…" : "Read aloud"}
      onClick={() => (loading || speaking ? stopSpeaking() : void speak(text, undefined, { id }))}
    >
      {loading ? (
        <LoaderIcon className="size-3.5 animate-spin" />
      ) : speaking ? (
        <Waveform
          level={state.metered ? speakerLevel : undefined}
          bars={3}
          className="h-3.5 gap-[2px] text-foreground"
          barClassName="w-[2px]"
        />
      ) : (
        <Volume2Icon className="size-3.5" />
      )}
    </MessageAction>
  );
}
