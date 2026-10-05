"use client";

import { exportChat, type ChatSession } from "@/features/chat-history";
import type { Project } from "@/features/projects";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownIcon, ChevronRightIcon, DownloadIcon, HistoryIcon } from "lucide-react";
import type { RefObject } from "react";
import { Link } from "react-router-dom";
import type { ChatMessage } from "../types";
import { ChatMessages } from "./chat-messages";
import { ProjectChip } from "./chat-title";
import { MessageSelectionToolbar } from "./message-selection-toolbar";

type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  /** The view is at the latest message; otherwise a "jump to latest" button shows. */
  atBottom?: boolean;
  onScrollToBottom?: () => void;
  session?: ChatSession;
  /** The project this chat belongs to, shown above the messages. */
  project?: Project;
  continuedFrom?: ChatSession["continuedFrom"];
  onRetry?: (userMessageId: string) => void;
  onRate?: (messageId: string, value: "up" | "down") => void;
  /** Send an edited prompt again as a new message. */
  onEdit?: (userMessageId: string, content: string) => void;
  className?: string;
};

export function ChatMessagePanel({
  messages,
  isLoading,
  containerRef,
  atBottom = true,
  onScrollToBottom,
  session,
  project,
  continuedFrom,
  onRetry,
  onRate,
  onEdit,
  className,
}: Props) {
  const canExport = !!session && messages.length > 0 && !isLoading;

  return (
    <div
      className={cn(
        "mx-auto flex min-h-0 w-full flex-col gap-3 flex-1",
        messages.length > 0 ? "flex-1" : "flex-none",
        className,
      )}
    >
      {(canExport || (project && messages.length > 0)) && (
        <div className="flex items-center justify-between gap-2 px-1">
          {project && messages.length > 0 ? <ProjectChip project={project} /> : <span />}
          {canExport && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void exportChat(session)}
            >
              <DownloadIcon className="size-3.5" />
              Export chat
            </Button>
          )}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <MessageSelectionToolbar containerRef={containerRef} />
        <div
          ref={containerRef}
          tabIndex={0}
          className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain scroll-hidden outline-none"
        >
          {/* Measured by useScroll to follow the reply as it grows. */}
          <div className="flex flex-col gap-4">
            {continuedFrom && <ContinuedFrom from={continuedFrom} isLoading={isLoading} />}
            <ChatMessages
              messages={messages}
              isLoading={isLoading}
              onRetry={onRetry}
              onRate={onRate}
              onEdit={onEdit}
              session={session}
            />
          </div>
        </div>

        {/* Centered by the wrapper: motion owns the button's transform. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
          <AnimatePresence>
            {!atBottom && messages.length > 0 && onScrollToBottom && (
              <motion.button
                key="jump-to-latest"
                type="button"
                onClick={onScrollToBottom}
                aria-label={isLoading ? "Follow the reply" : "Scroll to the latest message"}
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                className={cn(
                  "pointer-events-auto flex h-9 items-center gap-1.5 rounded-full border border-border/70",
                  "bg-background/90 px-3 text-xs font-medium text-foreground shadow-lg backdrop-blur",
                  "transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                )}
              >
                {isLoading && (
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-500/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
                  </span>
                )}
                <ArrowDownIcon className="size-3.5" />
                {isLoading ? "Follow reply" : "Latest"}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** Where this chat came from, and the summary it carries over. */
function ContinuedFrom({
  from,
  isLoading,
}: {
  from: NonNullable<ChatSession["continuedFrom"]>;
  isLoading: boolean;
}) {
  const link = (
    <Link
      to={`/chat/${from.id}`}
      title={from.title}
      className="max-w-[min(12rem,40vw)] truncate underline underline-offset-2"
    >
      {from.title}
    </Link>
  );

  if (from.summarizing && isLoading) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-xs">
        <HistoryIcon className="size-3.5 text-muted-foreground" />
        <TextShimmer duration={2} className="font-normal">
          Summarizing the previous chat…
        </TextShimmer>
      </p>
    );
  }

  if (!from.summary) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <HistoryIcon className="size-3.5" />
        Continues from {link}
      </p>
    );
  }

  return (
    <details className="group mx-auto w-full max-w-xl rounded-xl border bg-muted/30 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <HistoryIcon className="size-3.5 shrink-0" />
        <span className="flex min-w-0 items-center gap-1">Continues from {link} with a summary</span>
        <ChevronRightIcon className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="max-h-72 overflow-auto border-t px-3 py-2 text-sm">
        <MessageResponse>{from.summary}</MessageResponse>
      </div>
    </details>
  );
}
