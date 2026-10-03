"use client";

import { cn } from "@/lib/utils";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MediaFallback } from "./media-fallback";
import { MediaPreviewDialog, type MediaPreviewItem } from "./media-preview-dialog";
import { useProxiedImage } from "./use-proxied-image";

/** True once `el` comes within a screen or so of the viewport. */
function useNearViewport(el: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (near || !node) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [el, near]);
  return near;
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
  // Drew as data but the picture itself is bad.
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  // Web pictures load through the backend (the webview may not fetch them).
  const near = useNearViewport(boxRef);
  const image = useProxiedImage(src, near);
  const shown = broken ? undefined : image.src;

  // Cached images often finish loading before React attaches onLoad.
  useLayoutEffect(() => {
    setLoaded(false);
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [shown]);

  useEffect(() => setBroken(false), [src]);

  const items = useMemo<MediaPreviewItem[]>(() => {
    if (gallery?.length) return gallery;
    return [{ src: image.src ?? src, title: alt, kind: "image", localPath }];
  }, [gallery, image.src, src, alt, localPath]);

  if (image.failed || broken) {
    return (
      <MediaFallback
        src={src}
        title={alt}
        localPath={localPath}
        onRetry={() => {
          setBroken(false);
          image.retry();
        }}
        className={cn("my-2", fitContent ? "w-fit min-w-64" : undefined)}
      />
    );
  }

  return (
    <>
      <button
        ref={boxRef}
        type="button"
        disabled={!shown}
        onClick={() => setOpen(true)}
        title={alt || "Open full size"}
        className={cn(
          "relative block overflow-hidden text-left",
          fitContent ? "w-fit max-w-full" : "w-full",
          !loaded && (fitContent ? "min-h-36 min-w-56" : "min-h-36"),
          className,
        )}
      >
        {!loaded && (
          <div className="absolute inset-0 animate-pulse bg-muted/50" aria-hidden />
        )}
        {shown && (
          <img
            ref={imgRef}
            src={shown}
            alt={alt ?? ""}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className={cn(
              "relative z-[1] block max-w-full bg-muted/20 object-contain",
              fitContent ? "h-auto w-auto" : "w-full",
              imageClassName,
            )}
          />
        )}
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
