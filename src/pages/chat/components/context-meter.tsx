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
import { FolderIcon, SquarePenIcon } from "lucide-react";
import type { ContextUsage } from "../context-usage";
import type { ContextBudget } from "../models";

/** Warn once the chat uses this share of the window. */
export const CONTEXT_WARN_RATIO = 0.8;

type Props = {
  usage: ContextUsage;
  budget: ContextBudget;
  /** Folders this chat can read; their files count toward the context. */
  folders: string[];
  onNewChat?: () => void;
};

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export function ContextMeter({ usage, budget, folders, onNewChat }: Props) {
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
          aria-label="Context usage"
          className={cn("gap-1 px-1.5 text-xs tabular-nums", tone)}
        >
          {Math.round(ratio * 100)}%
          <RingIcon ratio={ratio} />
        </Button>
      </ContextTrigger>
      <ContextContent align="end" className="w-72">
        <ContextContentHeader />
        <ContextContentBody className="space-y-1.5">
          <Row label="Input" value={totals.inputTokens} />
          <Row label="Output" value={totals.outputTokens} />
          <Row label="Reasoning" value={totals.reasoningTokens} />
          <Row label="Cache read" value={totals.cacheReadTokens} />
          {!usage.reported && (
            <p className="text-[11px] text-muted-foreground">Estimated — this model doesn’t report usage.</p>
          )}
          {budget.autoNewChat && (
            <p className="text-[11px] text-muted-foreground">
              A new chat starts automatically at {compact.format(budget.maxTokens)} tokens.
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
        <ContextContentFooter>
          <span className="text-muted-foreground">Total cost</span>
          <span className="flex items-center gap-2">
            {usd.format(totals.cost)}
            {onNewChat && ratio >= CONTEXT_WARN_RATIO && (
              <Button type="button" size="xs" variant="outline" className="gap-1" onClick={onNewChat}>
                <SquarePenIcon className="size-3" />
                New chat
              </Button>
            )}
          </span>
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
