import { MessageResponse } from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { ChatCompaction } from "@/features/chat-history";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, CopyIcon, ListCollapseIcon } from "lucide-react";
import { useState } from "react";
import { estimateTokens } from "../context-usage";

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

/**
 * Where the chat was summarized: what the model remembers from here up,
 * instead of the messages above. Open, it shows the summary itself.
 */
export function CompactionCard({ compaction, current }: { compaction: ChatCompaction; current: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (compaction.summarizing) {
    return (
      <div className="my-3 flex items-center justify-center gap-1.5 text-xs" role="status">
        <ListCollapseIcon className="size-3.5 text-muted-foreground" />
        <TextShimmer duration={2} className="font-normal">
          Summarizing the chat so far…
        </TextShimmer>
      </div>
    );
  }
  if (!compaction.summary) return null;

  const after = estimateTokens(compaction.summary);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(compaction.summary ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is right there to select.
    }
  };

  return (
    <div className={cn("mx-auto my-3 w-full max-w-2xl rounded-xl border text-xs", current ? "border-primary/30 bg-primary/[0.04]" : "bg-muted/30")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ListCollapseIcon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium text-foreground">
            Summarized {compaction.messages} message{compaction.messages === 1 ? "" : "s"}
            <span className="font-normal text-muted-foreground">
              {" "}
              · ~{compact.format(compaction.tokensBefore)} → ~{compact.format(after)} tokens · {new Date(compaction.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </span>
          <span className="text-muted-foreground">
            {current
              ? "The model remembers this summary instead of the messages above. Keep going below."
              : "An earlier summary; the one further down includes it."}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? "Hide" : "Show what it kept"}</span>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="relative border-t px-4 py-3">
          <button
            type="button"
            onClick={() => void copy()}
            className="absolute top-2 right-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CopyIcon className="size-3" />
            {copied ? "Copied" : "Copy"}
          </button>
          <MessageResponse className="text-[13px] leading-relaxed">{compaction.summary}</MessageResponse>
        </div>
      )}
    </div>
  );
}
