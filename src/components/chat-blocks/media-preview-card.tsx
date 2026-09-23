"use client";

import { LinkPreviewCard } from "@/components/link-preview";
import type { MediaPreviewBlock } from "@/features/chat-blocks";
import { cn } from "@/lib/utils";
import { readFile } from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FilmIcon, FolderOpenIcon, GlobeIcon, ImageIcon, VideoOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ZoomableImage } from "./zoomable-image";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function fileNameOf(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  ogv: "video/ogg",
};

/**
 * A blob URL for a file on this computer. The webview cannot load `file://`
 * from an app page, so generated media is read through the file API — the
 * same route attachment previews take.
 */
function useLocalMedia(path: string | undefined) {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});

  useEffect(() => {
    if (!path) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    const type = MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
    readFile(path)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
        setState({ url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return state;
}

const KIND_ICON = {
  image: ImageIcon,
  video: FilmIcon,
  link: GlobeIcon,
} as const;

function VideoBody({ item, src }: { item: MediaPreviewBlock; src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 bg-muted/40 px-3 py-6 text-center">
        <VideoOffIcon className="size-5 text-muted-foreground/60" aria-hidden />
        <p className="text-xs text-muted-foreground">This video can't play here</p>
        <button
          type="button"
          onClick={() => void (item.local ? revealItemInDir(item.url) : openUrl(item.url))}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {item.local ? "Show in folder" : "Open in browser"}
        </button>
      </div>
    );
  }
  return (
    <video
      src={src}
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
  const local = useLocalMedia(item.local ? item.url : undefined);
  const source = item.local ? local.url : item.url;
  const title = item.title?.trim() || (item.local ? fileNameOf(item.url) : hostOf(item.url));
  const Icon = KIND_ICON[item.kind];

  return (
    <div
      data-skip-markdown-delegate
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm",
        className,
      )}
    >
      {item.local && !source && (
        <div className="flex h-40 items-center justify-center bg-muted/40 text-xs text-muted-foreground">
          {local.failed ? "This file is no longer there" : "Loading…"}
        </div>
      )}
      {item.kind === "image" && source && (
        <ZoomableImage src={item.thumbnail ?? source} alt={title} imageClassName="max-h-72" />
      )}
      {item.kind === "video" && source && <VideoBody item={item} src={source} />}
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
            onClick={() => void (item.local ? revealItemInDir(item.url) : openUrl(item.url))}
            title={item.url}
            className="mt-1 flex max-w-full items-center gap-1 text-[11px] text-muted-foreground/75 underline-offset-2 hover:text-foreground hover:underline"
          >
            <span className="truncate">
              {item.local ? "Show in folder" : hostOf(item.url)}
            </span>
            {item.local ? (
              <FolderOpenIcon className="size-2.5 shrink-0" aria-hidden />
            ) : (
              <ExternalLinkIcon className="size-2.5 shrink-0" aria-hidden />
            )}
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
