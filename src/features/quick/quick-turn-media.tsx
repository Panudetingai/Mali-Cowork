/**
 * Pictures and files the user sent with a Quick bar question, shown in their
 * bubble. The Quick bar is a small window, so a click opens the picture over
 * the thread instead of a full gallery.
 */
import { formatSize, useAttachmentPreview, type Attachment } from "@/features/attachments";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, FileTextIcon, FilmIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Pictures shown before the rest fold into "+N". */
const MAX_TILES = 3;

export function QuickTurnMedia({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");
  const [open, setOpen] = useState<number>();
  const tiles = images.slice(0, MAX_TILES);
  const more = images.length - tiles.length;

  return (
    <>
      {images.length > 0 && (
        <div className={cn("grid gap-1", images.length === 1 ? "grid-cols-1" : "grid-cols-3")}>
          {tiles.map((image, i) => (
            <Tile
              key={image.id}
              attachment={image}
              single={images.length === 1}
              more={i === tiles.length - 1 && more > 0 ? more : 0}
              onOpen={() => setOpen(i)}
            />
          ))}
        </div>
      )}
      {files.map((file) => (
        <FileRow key={file.id} attachment={file} />
      ))}
      <Lightbox images={images} index={open} onIndexChange={setOpen} />
    </>
  );
}

function Tile({
  attachment,
  single,
  more,
  onOpen,
}: {
  attachment: Attachment;
  single: boolean;
  more: number;
  onOpen: () => void;
}) {
  const preview = useAttachmentPreview(attachment);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      aria-label={more ? `Open pictures (${more} more)` : `Open ${attachment.name}`}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border/60 bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        single ? "max-h-40 max-w-56" : "size-20",
      )}
    >
      {preview ? (
        <img
          src={preview}
          alt=""
          className={cn(
            "transition-transform duration-200 group-hover:scale-105",
            single ? "max-h-40 w-auto object-contain" : "size-full object-cover",
          )}
        />
      ) : (
        <span className={cn("block animate-pulse bg-muted", single ? "h-28 w-40" : "size-full")} />
      )}
      {more > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-semibold text-white backdrop-blur-[1px]">
          +{more}
        </span>
      )}
    </button>
  );
}

function FileRow({ attachment }: { attachment: Attachment }) {
  const Icon = attachment.kind === "text" ? FileTextIcon : attachment.kind === "video" ? FilmIcon : FileIcon;
  return (
    <div className="flex max-w-56 items-center gap-2 rounded-lg border border-border/70 bg-muted/40 py-1 pr-2.5 pl-1.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background/70">
        <Icon className="size-3.5 text-muted-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium">{attachment.name}</span>
        <span className="block text-[10px] text-muted-foreground uppercase">
          {attachment.name.split(".").pop()} · {formatSize(attachment.size)}
        </span>
      </span>
    </div>
  );
}

function Lightbox({
  images,
  index,
  onIndexChange,
}: {
  images: Attachment[];
  index?: number;
  onIndexChange: (index: number | undefined) => void;
}) {
  const current = index == null ? undefined : images[index];

  useEffect(() => {
    if (index == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The bar closes on Esc; here it only closes the picture.
        event.preventDefault();
        event.stopPropagation();
        onIndexChange(undefined);
      } else if (event.key === "ArrowRight") onIndexChange(Math.min(images.length - 1, index + 1));
      else if (event.key === "ArrowLeft") onIndexChange(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, images.length, onIndexChange]);

  return createPortal(
    <AnimatePresence>
      {current && index != null && (
        <motion.div
          key="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center rounded-[var(--window-radius)] bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => onIndexChange(undefined)}
        >
          <LightboxImage attachment={current} />
          <button
            type="button"
            aria-label="Close"
            onClick={() => onIndexChange(undefined)}
            className="absolute top-3 right-3 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            <XIcon className="size-4" />
          </button>
          {images.length > 1 && (
            <>
              <NavButton side="left" disabled={index === 0} onClick={() => onIndexChange(index - 1)} />
              <NavButton side="right" disabled={index === images.length - 1} onClick={() => onIndexChange(index + 1)} />
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white tabular-nums">
                {index + 1} / {images.length}
              </span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function LightboxImage({ attachment }: { attachment: Attachment }) {
  const preview = useAttachmentPreview(attachment);
  if (!preview) return <span className="size-32 animate-pulse rounded-lg bg-white/10" />;
  return (
    <motion.img
      key={attachment.id}
      initial={{ scale: 0.96, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      src={preview}
      alt={attachment.name}
      onClick={(event) => event.stopPropagation()}
      className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
    />
  );
}

function NavButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous picture" : "Next picture"}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:opacity-30",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
