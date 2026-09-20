"use client";

import { LinkPreviewCard } from "@/components/link-preview";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentProps } from "react";

/** Markdown anchor with optional link preview on hover (http(s) only). */
export function MarkdownLink({ href, children, className, ...props }: ComponentProps<"a">) {
  const url = href?.trim();
  if (url && /^https?:\/\//i.test(url)) {
    return (
      <LinkPreviewCard href={url} className={cn("text-primary", className)}>
        {children ?? url}
      </LinkPreviewCard>
    );
  }
  if (url) {
    return (
      <button
        type="button"
        {...(props as ComponentProps<"button">)}
        onClick={() => void openUrl(url)}
        className={cn("inline font-medium underline underline-offset-2", className)}
      >
        {children ?? url}
      </button>
    );
  }
  return (
    <span className={className} {...props}>
      {children}
    </span>
  );
}
