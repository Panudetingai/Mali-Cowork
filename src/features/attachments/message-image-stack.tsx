"use client";

import { MediaPreviewDialog, type MediaPreviewItem } from "@/components/chat-blocks/media-preview-dialog";
import { ZoomableImage } from "@/components/chat-blocks/zoomable-image";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import type { Attachment } from "./types";
import { useAttachmentPreview } from "./use-attachment-preview";

const THUMB = 88;
const STACK_OFFSET = 10;
const FAN_GAP = 76;

function StackThumb({
  attachment,
  index,
  total,
  expanded,
  onOpen,
  onPreview,
}: {
  attachment: Attachment;
  index: number;
  total: number;
  expanded: boolean;
  onOpen: () => void;
  onPreview: (index: number, src: string | undefined, attachment: Attachment) => void;
}) {
  const preview = useAttachmentPreview(attachment);
  const mid = (total - 1) / 2;
  const rotate = expanded ? 0 : (index - mid) * 5;
  const translateX = expanded ? index * FAN_GAP : index * STACK_OFFSET;

  useEffect(() => {
    onPreview(index, preview, attachment);
  }, [preview, attachment, index, onPreview]);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      aria-label={`Open ${attachment.name}`}
      className={cn(
        "absolute top-0 left-0 overflow-hidden rounded-xl border-2 border-background bg-muted/40 shadow-md",
        "transition-[transform,box-shadow,z-index] duration-300 ease-out",
        "hover:z-50 hover:shadow-lg focus-visible:z-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{
        width: THUMB,
        height: THUMB,
        zIndex: index,
        transform: `translateX(${translateX}px) rotate(${rotate}deg)`,
      }}
    >
      {preview ? (
        <img src={preview} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="block size-full animate-pulse bg-muted" aria-hidden />
      )}
    </button>
  );
}

function MessageImageStack({ attachments }: { attachments: Attachment[] }) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);
  const [gallerySlots, setGallerySlots] = useState<(MediaPreviewItem | undefined)[]>(() =>
    attachments.map(() => undefined),
  );

  const collapsedWidth = THUMB + (attachments.length - 1) * STACK_OFFSET;
  const expandedWidth = THUMB + (attachments.length - 1) * FAN_GAP;

  const setPreview = useCallback((index: number, src: string | undefined, attachment: Attachment) => {
    setGallerySlots((prev) => {
      const existing = prev[index];
      if (!src && !existing) return prev;
      if (existing?.src === src) return prev;
      const next = [...prev];
      next[index] = src
        ? { src, title: attachment.name, kind: "image", localPath: attachment.path }
        : undefined;
      return next;
    });
  }, []);

  const gallery = gallerySlots.filter((item): item is MediaPreviewItem => !!item);

  const openAt = (attachmentIndex: number) => {
    const slot = gallerySlots[attachmentIndex];
    if (!slot) return;
    const galleryIndex = gallery.findIndex((item) => item.localPath === slot.localPath);
    setInitialIndex(galleryIndex >= 0 ? galleryIndex : 0);
    setOpen(true);
  };

  return (
    <>
      <div
        className="relative py-1 transition-[width] duration-300 ease-out"
        style={{ width: expanded ? expandedWidth : collapsedWidth, height: THUMB + 8 }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false);
        }}
      >
        {attachments.map((attachment, index) => (
          <StackThumb
            key={attachment.id}
            attachment={attachment}
            index={index}
            total={attachments.length}
            expanded={expanded}
            onOpen={() => openAt(index)}
            onPreview={setPreview}
          />
        ))}
        {!expanded && attachments.length > 1 && (
          <span
            className="pointer-events-none absolute -top-1 -right-1 z-[60] flex min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background shadow"
            aria-hidden
          >
            {attachments.length}
          </span>
        )}
      </div>
      <MediaPreviewDialog open={open} onOpenChange={setOpen} items={gallery} initialIndex={initialIndex} />
    </>
  );
}

function SingleMessageImage({ attachment }: { attachment: Attachment }) {
  const preview = useAttachmentPreview(attachment);
  if (!preview) {
    return (
      <div className="h-32 w-40 animate-pulse rounded-xl border border-border/60 bg-muted/30" aria-hidden />
    );
  }
  return (
    <ZoomableImage
      src={preview}
      alt={attachment.name}
      fitContent
      localPath={attachment.path}
      className="overflow-hidden rounded-xl border border-border/60"
      imageClassName="max-h-48 max-w-xs"
    />
  );
}

/** Inline image attachments in a user message — stacked when there are several. */
export function MessageImageAttachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  if (attachments.length === 1) return <SingleMessageImage attachment={attachments[0]} />;
  return <MessageImageStack attachments={attachments} />;
}
