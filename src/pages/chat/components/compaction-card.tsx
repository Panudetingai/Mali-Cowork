import { MessageResponse } from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { ChatCompaction } from "@/features/chat-history";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, CopyIcon, ListCollapseIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { estimateTokens } from "../context-usage";

const compact = new Intl.NumberFormat("en-US", { notation: "compact" });

/**
 * Where the chat was summarized: a quiet divider, like "Moved to Cowork".
 * Open, the summary reads as plain text under it — what the model remembers
 * from here up, instead of the messages above.
 */
export function CompactionCard({ compaction, current }: { compaction: ChatCompaction; current: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const reduced = useReducedMotion();

  if (compaction.summarizing) {
    return (
      <Divider>
        <ListCollapseIcon className="size-3.5 shrink-0" />
        <TextShimmer duration={2} className="font-normal">
          Summarizing the chat so far…
        </TextShimmer>
      </Divider>
    );
  }
  if (!compaction.summary) return null;

  const after = estimateTokens(compaction.summary);
  const time = new Date(compaction.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    <div className="my-2">
      <Divider>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={current ? "The model remembers this summary instead of the messages above" : "An earlier summary; the one further down includes it"}
          className="group inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors hover:text-foreground"
        >
          <ListCollapseIcon className={cn("size-3.5 shrink-0", current && "text-primary")} />
          <span>
            Summarized {compaction.messages} message{compaction.messages === 1 ? "" : "s"}
            <span className="text-muted-foreground/70">
              {" "}
              · ~{compact.format(compaction.tokensBefore)} → ~{compact.format(after)} tokens · {time}
            </span>
          </span>
          <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </Divider>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="summary"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="w-full pt-3 pb-1">
              <p className="mb-2 text-[11px] text-muted-foreground">
                {current
                  ? "What the model remembers from here up — the messages above aren't sent again."
                  : "An earlier summary; the one further down includes it."}
              </p>
              <MessageResponse className="text-[13px] leading-relaxed text-foreground/85">{compaction.summary}</MessageResponse>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 hover:text-foreground">
                  {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="hover:text-foreground">
                  Hide
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A hairline either side, the words in the middle — the chat's own dividers. */
function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border/70" />
      <span className="inline-flex min-w-0 items-center gap-1.5">{children}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}
