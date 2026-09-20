"use client";

import { LinkPreviewCard } from "@/components/link-preview";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, type ReactNode } from "react";

const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?'")\]}>]/g;

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/, "");
}

type Props = {
  text: string;
  className?: string;
  linkClassName?: string;
  /** When false, links open on click only (no hover card). */
  preview?: boolean;
};

function PlainLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(href)}
      className={cn(
        "inline text-left font-medium underline underline-offset-2 hover:opacity-90 break-all",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Plain text with http(s) URLs turned into links; optional hover preview card. */
export function AutolinkText({ text, className, linkClassName, preview = true }: Props) {
  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(URL_RE)) {
      const start = match.index ?? 0;
      if (start > last) {
        out.push(text.slice(last, start));
      }
      const raw = match[0];
      const href = trimTrailingPunctuation(raw);
      const trailing = raw.slice(href.length);
      const link = preview ? (
        <LinkPreviewCard key={start} href={href} className={linkClassName}>
          {href}
        </LinkPreviewCard>
      ) : (
        <PlainLink key={start} href={href} className={linkClassName}>
          {href}
        </PlainLink>
      );
      out.push(link);
      if (trailing) out.push(trailing);
      last = start + raw.length;
    }
    if (last < text.length) {
      out.push(text.slice(last));
    }
    return out.length > 0 ? out : [text];
  }, [text, linkClassName, preview]);

  return <span className={className}>{nodes}</span>;
}
