"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, ImageOffIcon, MaximizeIcon } from "lucide-react";
import { useState } from "react";

function isRemote(src: string) {
  return /^https?:\/\//i.test(src);
}

/** A picture that failed to load, said plainly instead of a broken icon. */
function BrokenImage({ src, className }: { src: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 bg-muted/40 px-3 py-6 text-center",
        className,
      )}
    >
      <ImageOffIcon className="size-5 text-muted-foreground/60" aria-hidden />
      <p className="text-xs text-muted-foreground">Couldn't load this image</p>
      {isRemote(src) && (
        <button
          type="button"
          onClick={() => void openUrl(src)}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Open in browser
        </button>
      )}
    </div>
  );
}

/**
 * Pictures an agent or MCP tool sends back are usually screenshots, and a
 * screenshot shrunk into the chat column is unreadable — so every one of them
 * opens full size on click, and says so on hover.
 */
export function ZoomableImage({
  src,
  alt,
  className,
  imageClassName,
}: {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) return <BrokenImage src={src} className={className} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={alt || "Open full size"}
        className={cn("group relative block w-full overflow-hidden text-left", className)}
      >
        {!loaded && <div className="absolute inset-0 animate-pulse bg-muted/60" aria-hidden />}
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "w-full bg-muted/30 object-contain transition-opacity",
            loaded ? "opacity-100" : "opacity-0",
            imageClassName,
          )}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <MaximizeIcon className="size-3" />
          Full size
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(72rem,94vw)] gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,94vw)]">
          <DialogTitle className="sr-only">{alt || "Image preview"}</DialogTitle>
          <img
            src={src}
            alt={alt ?? ""}
            className="max-h-[80svh] w-full bg-muted/20 object-contain"
          />
          <div className="flex items-center gap-2 border-t px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={alt || src}>
              {alt || src}
            </p>
            {isRemote(src) && (
              <button
                type="button"
                onClick={() => void openUrl(src)}
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Open in browser
                <ExternalLinkIcon className="size-3" />
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
