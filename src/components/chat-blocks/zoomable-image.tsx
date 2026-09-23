"use client";

import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ImageOffIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { MediaPreviewDialog, type MediaPreviewItem } from "./media-preview-dialog";

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
  /** Size to the image’s aspect ratio instead of stretching to the column width. */
  fitContent,
  localPath,
  gallery,
  galleryIndex = 0,
}: {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  fitContent?: boolean;
  localPath?: string;
  /** When set, the preview dialog can slide between siblings. */
  gallery?: MediaPreviewItem[];
  galleryIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Cached images often finish loading before React attaches onLoad.
  useLayoutEffect(() => {
    setLoaded(false);
    setFailed(false);
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const items = useMemo<MediaPreviewItem[]>(() => {
    if (gallery?.length) return gallery;
    return [{ src, title: alt, kind: "image", localPath }];
  }, [gallery, src, alt, localPath]);

  if (failed) return <BrokenImage src={src} className={className} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={alt || "Open full size"}
        className={cn(
          "relative block overflow-hidden text-left",
          fitContent ? "w-fit max-w-full" : "w-full",
          !loaded && (fitContent ? "min-h-36 min-w-56" : "min-h-36"),
          className,
        )}
      >
        {!loaded && !failed && (
          <div className="absolute inset-0 animate-pulse bg-muted/50" aria-hidden />
        )}
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "relative z-[1] block max-w-full bg-muted/20 object-contain",
            fitContent ? "h-auto w-auto" : "w-full",
            imageClassName,
          )}
        />
      </button>

      <MediaPreviewDialog
        open={open}
        onOpenChange={setOpen}
        items={items}
        initialIndex={gallery?.length ? galleryIndex : 0}
      />
    </>
  );
}
