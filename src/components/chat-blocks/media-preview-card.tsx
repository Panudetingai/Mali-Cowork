"use client";

import { LinkPreviewCard } from "@/components/link-preview";
import type { MediaPreviewBlock } from "@/features/chat-blocks";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FilmIcon, ImageIcon } from "lucide-react";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function MediaPreviewCard({
  item,
  className,
}: {
  item: MediaPreviewBlock;
  className?: string;
}) {
  const title = item.title?.trim() || hostOf(item.url);

  return (
    <div
      data-skip-markdown-delegate
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm",
        className,
      )}
    >
      {item.kind === "image" && (
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => void openUrl(item.url)}
        >
          <img
            src={item.thumbnail ?? item.url}
            alt={title}
            className="max-h-72 w-full bg-muted/40 object-contain"
            loading="lazy"
          />
        </button>
      )}
      {item.kind === "video" && (
        <video
          src={item.url}
          poster={item.thumbnail}
          controls
          playsInline
          className="max-h-72 w-full bg-black object-contain"
        />
      )}
      {item.kind === "link" && (
        <div className="border-b border-border/60 bg-muted/30 px-3 py-6">
          <LinkPreviewCard href={item.url} className="text-sm font-medium">
            {title}
          </LinkPreviewCard>
        </div>
      )}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className="mt-0.5 text-muted-foreground">
          {item.kind === "video" ? (
            <FilmIcon className="size-3.5" aria-hidden />
          ) : item.kind === "image" ? (
            <ImageIcon className="size-3.5" aria-hidden />
          ) : (
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          )}
          <p className="mt-1 truncate text-[11px] text-muted-foreground/75">{item.url}</p>
        </div>
      </div>
    </div>
  );
}

export function MediaPreviewList({
  items,
  className,
}: {
  items: MediaPreviewBlock[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <MediaPreviewCard key={`${item.kind}-${item.url}`} item={item} />
      ))}
    </div>
  );
}
