import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { Button } from "@/components/ui/button";
import { folderName } from "@/features/workspace";
import { cn } from "@/lib/utils";
import { FolderIcon, ListCollapseIcon, SquarePenIcon } from "lucide-react";
import type { ContextUsage } from "../context-usage";
import type { ContextBudget } from "../models";

/** Warn once the chat uses this share of the window. */
export const CONTEXT_WARN_RATIO = 0.8;

type Props = {
  /** Ring only; the percentage is in the tooltip. For narrow composers. */
  ringOnly?: boolean;
  usage: ContextUsage;
  budget: ContextBudget;
  /** Folders this chat can read; their files count toward the context. */
  folders: string[];
  onNewChat?: () => void;
  /** Summarize the chat so far and keep going in it. */
  onSummarize?: () => void;
  /** Messages a summary already covers (the model hears the summary instead). */
  summarized?: number;
};

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export function ContextMeter({ usage, budget, folders, onNewChat, onSummarize, summarized, ringOnly }: Props) {
  const used = Math.min(usage.usedTokens, budget.maxTokens);
  const ratio = used / budget.maxTokens;
  const tone =
    ratio >= 1
      ? "text-red-600 dark:text-red-400"
      : ratio >= CONTEXT_WARN_RATIO
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  const { totals } = usage;

  return (
    <Context usedTokens={used} maxTokens={budget.maxTokens}>
      <ContextTrigger>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Context usage ${Math.round(ratio * 100)}%`}
          title={ringOnly ? `${Math.round(ratio * 100)}% of context used` : undefined}
          className={cn("gap-1 px-1.5 text-xs tabular-nums", tone)}
        >
          {!ringOnly && `${Math.round(ratio * 100)}%`}
          <RingIcon ratio={ratio} />
        </Button>
      </ContextTrigger>
      <ContextContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <ContextContentHeader />
        <ContextContentBody className="space-y-1.5">
          <Row label="Input" value={totals.inputTokens} />
          <Row label="Output" value={totals.outputTokens} />
          <Row label="Reasoning" value={totals.reasoningTokens} />
          <Row label="Cache read" value={totals.cacheReadTokens} />
          {!usage.reported && (
            <p className="text-[11px] text-muted-foreground">Estimated — this model doesn’t report usage.</p>
          )}
          {summarized ? (
            <p className="text-[11px] text-muted-foreground">
              {summarized} earlier message{summarized === 1 ? " is" : "s are"} summarized: the model hears the summary, not the full text.
            </p>
          ) : null}
          {budget.autoNewChat && (
            <p className="text-[11px] text-muted-foreground">
              At {compact.format(budget.maxTokens)} tokens the chat so far is summarized, and you keep going here.
            </p>
          )}
          {folders.length > 0 && (
            <div className="space-y-1 pt-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                Files read from these folders count toward the context
              </p>
              {folders.map((folder) => (
                <p key={folder} title={folder} className="flex items-center gap-1.5 truncate text-xs">
                  <FolderIcon className="size-3 shrink-0 text-muted-foreground" />
                  {folderName(folder)}
                </p>
              ))}
            </div>
          )}
        </ContextContentBody>
        <ContextContentFooter className="flex-col items-stretch gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">Total cost</span>
            <span className="tabular-nums">{usd.format(totals.cost)}</span>
          </div>
          {onSummarize || (onNewChat && ratio >= CONTEXT_WARN_RATIO) ? (
            <div className="flex flex-col gap-1.5">
              {onSummarize && (
                <Button
                  type="button"
                  size="xs"
                  variant={ratio >= CONTEXT_WARN_RATIO / 2 ? "default" : "outline"}
                  className="h-8 w-full justify-center gap-1.5 px-2"
                  onClick={onSummarize}
                  title="Summarize the chat so far and keep going here: the model remembers the summary, and you can open it in the chat"
                >
                  <ListCollapseIcon className="size-3 shrink-0" />
                  <span className="truncate">Summarize now — keep going here</span>
                </Button>
              )}
              {onNewChat && ratio >= CONTEXT_WARN_RATIO && (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="h-8 w-full justify-center gap-1.5 px-2"
                  onClick={onNewChat}
                >
                  <SquarePenIcon className="size-3 shrink-0" />
                  <span className="truncate">New chat</span>
                </Button>
              )}
            </div>
          ) : null}
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{compact.format(value)}</span>
    </div>
  );
}

function RingIcon({ ratio }: { ratio: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(ratio, 1))}
      />
    </svg>
  );
}
