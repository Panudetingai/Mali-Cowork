"use client";

import { LinkPreviewCard } from "@/components/link-preview";
import { isOAuthUrl } from "@/features/chat-blocks";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";

function openExternal(event: MouseEvent, href: string) {
  event.preventDefault();
  event.stopPropagation();
  void openUrl(href);
}

/** OAuth / sign-in links render as an obvious button (hover cards block some clicks). */
function OAuthLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-chat-oauth-link=""
      onClick={(e) => openExternal(e, href)}
      className={cn(
        "relative z-10 inline-flex cursor-pointer items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5",
        "text-sm font-medium text-primary underline-offset-2 hover:bg-primary/15",
        className,
      )}
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0 opacity-80" aria-hidden />
    </button>
  );
}

/** Markdown anchor with optional link preview on hover (http(s) only). */
export function MarkdownLink({ href, children, className, ...props }: ComponentProps<"a">) {
  const url = href?.trim();
  if (url && /^https?:\/\//i.test(url)) {
    if (isOAuthUrl(url)) {
      return (
        <OAuthLink href={url} className={className}>
          {children ?? url}
        </OAuthLink>
      );
    }
    return (
      <LinkPreviewCard href={url} className={cn("relative z-10 text-primary", className)}>
        {children ?? url}
      </LinkPreviewCard>
    );
  }
  if (url) {
    return (
      <button
        type="button"
        {...(props as ComponentProps<"button">)}
        onClick={(e) => openExternal(e, url)}
        className={cn(
          "relative z-10 inline cursor-pointer font-medium underline underline-offset-2",
          className,
        )}
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
