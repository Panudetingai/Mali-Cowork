"use client";

import { LinkPreviewCard } from "@/components/link-preview";
import type { MediaPreviewBlock } from "@/features/chat-blocks";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FilmIcon, GlobeIcon, ImageIcon, VideoOffIcon } from "lucide-react";
import { useState } from "react";
import { ZoomableImage } from "./zoomable-image";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const KIND_ICON = {
  image: ImageIcon,
  video: FilmIcon,
  link: GlobeIcon,
} as const;

function VideoBody({ item }: { item: MediaPreviewBlock }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 bg-muted/40 px-3 py-6 text-center">
        <VideoOffIcon className="size-5 text-muted-foreground/60" aria-hidden />
        <p className="text-xs text-muted-foreground">This video can't play here</p>
        <button
          type="button"
          onClick={() => void openUrl(item.url)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Open in browser
        </button>
      </div>
    );
  }
  return (
    <video
      src={item.url}
      poster={item.thumbnail}
      controls
      playsInline
      // Metadata only: a chat can carry several clips and none of them were asked for yet.
      preload="metadata"
      onError={() => setFailed(true)}
      className="max-h-72 w-full bg-black object-contain"
    />
  );
}

export function MediaPreviewCard({
  item,
  className,
}: {
  item: MediaPreviewBlock;
  className?: string;
}) {
  const title = item.title?.trim() || hostOf(item.url);
  const Icon = KIND_ICON[item.kind];

  return (
    <div
      data-skip-markdown-delegate
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm",
        className,
      )}
    >
      {item.kind === "image" && (
        <ZoomableImage src={item.thumbnail ?? item.url} alt={title} imageClassName="max-h-72" />
      )}
      {item.kind === "video" && <VideoBody item={item} />}
      {item.kind === "link" && item.thumbnail && (
        <ZoomableImage src={item.thumbnail} alt={title} imageClassName="max-h-52" />
      )}

      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {item.kind === "link" ? (
            <LinkPreviewCard href={item.url} className="text-sm font-medium no-underline">
              {title}
            </LinkPreviewCard>
          ) : (
            <p className="truncate text-sm font-medium" title={title}>
              {title}
            </p>
          )}
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          )}
          <button
            type="button"
            onClick={() => void openUrl(item.url)}
            title={item.url}
            className="mt-1 flex max-w-full items-center gap-1 text-[11px] text-muted-foreground/75 underline-offset-2 hover:text-foreground hover:underline"
          >
            <span className="truncate">{hostOf(item.url)}</span>
            <ExternalLinkIcon className="size-2.5 shrink-0" aria-hidden />
          </button>
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
    <div
      className={cn(
        // One wide card reads better than a half-width one; two or more tile.
        items.length === 1 ? "grid gap-2" : "grid gap-2 sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <MediaPreviewCard key={`${item.kind}-${item.url}`} item={item} />
      ))}
    </div>
  );
}
