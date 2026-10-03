"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FolderOpenIcon, ImageOffIcon, LoaderIcon, RotateCwIcon } from "lucide-react";

/** "Cover — 1080x1440" → the name and the size, apart. */
function splitSize(text: string | undefined) {
  const match = text?.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/);
  if (!text || !match) return { name: text?.trim(), size: undefined };
  const name = text
    .replace(match[0], "")
    .replace(/[\s—–\-·|,()]+$/, "")
    .trim();
  return { name: name || undefined, size: `${match[1]}×${match[2]}` };
}

/**
 * A picture (or video) that couldn't load, said plainly, with what can be
 * done about it: try again, open it in the browser, or show the file.
 */
export function MediaFallback({
  src,
  title,
  localPath,
  kind = "image",
  onRetry,
  retrying,
  className,
}: {
  src?: string;
  title?: string;
  localPath?: string;
  kind?: "image" | "video";
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { name, size } = splitSize(title);
  const remote = !!src && /^https?:\/\//i.test(src);

  return (
    <div
      role="group"
      aria-label={kind === "video" ? "Video unavailable" : "Image unavailable"}
      className={cn(
        "flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl bg-muted/30 px-4 py-5 text-center ring-1 ring-border/60",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-background text-muted-foreground ring-1 ring-border/60">
        <ImageOffIcon className="size-[18px]" aria-hidden />
      </span>
      <div className="flex min-w-0 max-w-full flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {kind === "video" ? "Couldn't play this video" : "Couldn't load this image"}
        </p>
        {(name || size) && (
          <p className="flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
            {name && <span className="truncate">{name}</span>}
            {size && (
              <span className="shrink-0 rounded-full bg-background px-1.5 py-px text-[10px] font-medium tabular-nums ring-1 ring-border/60">
                {size}
              </span>
            )}
          </p>
        )}
      </div>
      {(onRetry || remote || localPath) && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {onRetry && (
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 rounded-xl text-xs" onClick={onRetry} disabled={retrying}>
              {retrying ? <LoaderIcon className="size-3 animate-spin" /> : <RotateCwIcon className="size-3" />}
              Retry
            </Button>
          )}
          {remote && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 rounded-xl text-xs"
              onClick={() => void openUrl(src).catch(() => undefined)}
            >
              <ExternalLinkIcon className="size-3" />
              Open in browser
            </Button>
          )}
          {localPath && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 rounded-xl text-xs"
              onClick={() => void revealItemInDir(localPath).catch(() => undefined)}
            >
              <FolderOpenIcon className="size-3" />
              Show in folder
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
