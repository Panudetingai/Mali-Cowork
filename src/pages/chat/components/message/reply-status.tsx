"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import { THINKING_AFTER_MS, useQuietFor } from "@/hooks/use-quiet-for";

/** The wait shows its seconds from here on. */
const SHOW_SECONDS_FROM = 3;
/** Past this, say a long wait is normal, so it doesn't read as stuck. */
const LONG_WAIT_S = 30;

/** The latest thing the model said to itself, as one plain line. */
function lastThought(reasoning: string | undefined) {
  const line = reasoning
    ?.split("\n")
    .map((l) => l.replace(/[*_#`>]/g, "").trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return undefined;
  return line.length > 160 ? `…${line.slice(-160)}` : line;
}

/**
 * What a reply in progress is doing between its steps: writing, or thinking
 * (with how long, and its latest thought when the model shares them), so a
 * long think never looks like the app froze.
 */
export function ReplyStatus({
  growth,
  reasoning,
  hasContent,
  cli,
}: {
  /** Changes whenever the reply grows (text, steps); quiet means thinking. */
  growth: number;
  reasoning?: string;
  hasContent: boolean;
  /** CLI agents don't say when they think; they're just working. */
  cli: boolean;
}) {
  // Reasoning doesn't count: while it streams, the reply itself is quiet.
  const quietFor = useQuietFor(growth);
  const thinking = !hasContent || quietFor >= THINKING_AFTER_MS;

  if (!thinking) {
    return (
      <div role="status" aria-label="Writing reply" className="mt-2 flex h-7 items-center gap-1 text-muted-foreground">
        <CoworkBot size={32} state="working" />
      </div>
    );
  }

  const seconds = Math.floor(quietFor / 1000);
  const thought = cli ? undefined : lastThought(reasoning);
  const label = cli ? "Working…" : "Thinking…";

  return (
    <div role="status" aria-live="polite" className="mb-2 flex items-start gap-2">
      <CoworkBot size={32} state="thinking" />
      <div className="flex min-w-0 flex-col gap-0.5 pt-2">
        <span className="text-[11px] text-muted-foreground">
          <span className="animate-pulse">{label}</span>
          {seconds >= SHOW_SECONDS_FROM && <span className="ml-1.5 tabular-nums opacity-70">{seconds}s</span>}
        </span>
        {thought && <span className="max-w-md truncate text-[11px] italic text-muted-foreground/70">{thought}</span>}
        {seconds >= LONG_WAIT_S && (
          <span className="text-[11px] text-muted-foreground/70">Still working — bigger tasks can take a minute or two.</span>
        )}
      </div>
    </div>
  );
}
