"use client";

import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent, ReactNode } from "react";

/** Ensures markdown links open via Tauri even when rendered as plain `<a>` tags. */
export function MarkdownSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a[href]");
    if (!anchor || anchor.closest("[data-skip-markdown-delegate]")) return;
    const href = anchor.getAttribute("href")?.trim();
    if (!href || !/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    void openUrl(href);
  };

  return (
    <div
      className={cn(
        "[&_a[href]]:pointer-events-auto [&_a[href]]:cursor-pointer",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
