"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { cn } from "@/lib/utils";

const MARKDOWN_EXT = new Set(["md", "mdx", "markdown"]);

export function isMarkdownRel(rel: string) {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXT.has(ext);
}

/** Rendered markdown for the code editor preview pane. */
export function MarkdownFilePreview({ text, className }: { text: string; className?: string }) {
  return (
    <MarkdownSurface className={cn("h-full overflow-auto px-6 py-4", className)}>
      <MessageResponse className="prose prose-sm dark:prose-invert max-w-none text-sm">{text}</MessageResponse>
    </MarkdownSurface>
  );
}
