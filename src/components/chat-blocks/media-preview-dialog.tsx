"use client";

import { cn } from "@/lib/utils";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FilmIcon,
  FolderOpenIcon,
  ImageIcon,
  Trash2Icon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
  type LucideIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";

export type MediaPreviewItem = {
  src: string;
  title?: string;
  kind?: "image" | "video" | "file";
  /** Disk path when the preview is a local generated file. */
  localPath?: string;
};

const KIND_LABEL = { image: "Image", video: "Video", file: "File" } as const;
const KIND_ICON = { image: ImageIcon, video: FilmIcon, file: FileIcon } as const;

function fileNameOf(item: MediaPreviewItem) {
  if (item.title?.trim()) return item.title.trim();
  const raw = item.localPath ?? item.src;
  try {
    const u = new URL(raw);
    return decodeURIComponent(u.pathname.split("/").pop() || "file");
  } catch {
    return raw.split(/[\\/]/).pop() || "file";
  }
}

function extensionOf(item: MediaPreviewItem) {
  const name = (item.localPath ?? fileNameOf(item)).split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
}

function isRemote(src: string) {
  return /^https?:\/\//i.test(src);
}

async function downloadItem(item: MediaPreviewItem, filename: string) {
  if (item.localPath && isTauri()) {
    const dest = await save({ defaultPath: filename, title: "Save file" });
    if (!dest) return;
    await writeFile(dest, await readFile(item.localPath));
    return;
  }
  try {
    const blob = await (await fetch(item.src)).blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    // Cross-origin images can't be fetched from the webview; hand off to the browser.
    if (isRemote(item.src)) void openUrl(item.src);
  }
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous" : "Next"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20",
        side === "left" ? "left-3 sm:left-5" : "right-3 sm:right-5",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Non-image, non-video files: a calm card instead of a broken <img>. */
function FileStage({ item, filename, onOpen }: { item: MediaPreviewItem; filename: string; onOpen: () => void }) {
  const ext = extensionOf(item);
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] px-8 py-10 text-center text-white"
    >
      <div className="relative">
        <FileIcon className="size-16 text-white/40" strokeWidth={1.25} aria-hidden />
        {ext && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-black">
            {ext}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={filename}>
          {filename}
        </p>
        <p className="mt-1 text-xs text-white/50">No preview available for this file type</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
      >
        {item.localPath ? <FolderOpenIcon className="size-3.5" /> : <ExternalLinkIcon className="size-3.5" />}
        {item.localPath ? "Show in folder" : "Open"}
      </button>
    </div>
  );
}

function Thumb({ item, active, onClick }: { item: MediaPreviewItem; active: boolean; onClick: () => void }) {
  const kind = item.kind ?? "image";
  const Icon = KIND_ICON[kind];
  return (
    <button
      type="button"
      aria-label={fileNameOf(item)}
      aria-current={active}
      onClick={onClick}
      className={cn(
        "relative size-12 shrink-0 overflow-hidden rounded-md ring-2 transition-all",
        active ? "opacity-100 ring-white" : "opacity-50 ring-transparent hover:opacity-80",
      )}
    >
      {kind === "image" ? (
        <img src={item.src} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center bg-white/10 text-white/70">
          <Icon className="size-4" />
        </span>
      )}
    </button>
  );
}

/**
 * Full-screen lightbox for generated or attached media. Images get fit/actual
 * size, galleries slide with arrows or thumbnails, and every file can be saved,
 * copied or opened where it lives.
 */
export function MediaPreviewDialog({
  open,
  onOpenChange,
  items,
  initialIndex = 0,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: MediaPreviewItem[];
  initialIndex?: number;
  onRemove?: (index: number) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const count = items.length;
  const multi = count > 1;
  const item = items[Math.min(index, count - 1)];
  const kind = item?.kind ?? "image";
  const filename = item ? fileNameOf(item) : "";

  useEffect(() => {
    if (open) setIndex(Math.min(initialIndex, Math.max(0, count - 1)));
  }, [open, initialIndex, count]);

  useEffect(() => {
    setZoomed(false);
    setSize(null);
  }, [index, open]);

  const go = useCallback(
    (delta: number) => {
      if (count <= 1) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (!open || count <= 1) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, go]);

  if (!item) return null;

  const close = () => onOpenChange(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(item.localPath ?? item.src);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard may be blocked.
    }
  };

  const openExternal = () => {
    if (item.localPath) void revealItemInDir(item.localPath);
    else if (isRemote(item.src)) void openUrl(item.src);
  };

  const canOpenExternal = !!item.localPath || isRemote(item.src);

  const meta = [
    KIND_LABEL[kind],
    size && `${size.w} × ${size.h}`,
    multi && `${index + 1} of ${count}`,
  ].filter(Boolean);

  let stage: ReactNode;
  if (kind === "video") {
    stage = (
      <video
        key={item.src}
        src={item.src}
        controls
        autoPlay
        playsInline
        onClick={(event) => event.stopPropagation()}
        onLoadedMetadata={(event) =>
          setSize({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight })
        }
        className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
      />
    );
  } else if (kind === "file") {
    stage = <FileStage item={item} filename={filename} onOpen={openExternal} />;
  } else {
    stage = (
      <img
        key={item.src}
        src={item.src}
        alt={filename}
        draggable={false}
        onClick={(event) => {
          event.stopPropagation();
          setZoomed((z) => !z);
        }}
        onLoad={(event) =>
          setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
        }
        className={cn(
          "rounded-md shadow-2xl select-none animate-in fade-in-0 zoom-in-[0.98] duration-200",
          zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain",
        )}
      />
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80">
              {(() => {
                const Icon = KIND_ICON[kind];
                return <Icon className="size-4" aria-hidden />;
              })()}
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-medium" title={filename}>
                {filename}
              </DialogPrimitive.Title>
              <p className="truncate text-[11px] text-white/50">{meta.join(" · ")}</p>
            </div>
            <div className="flex items-center gap-0.5">
              {kind === "image" && (
                <ToolButton
                  label={zoomed ? "Fit to screen" : "Actual size"}
                  icon={zoomed ? ZoomOutIcon : ZoomInIcon}
                  onClick={() => setZoomed((z) => !z)}
                  className="hidden sm:flex"
                />
              )}
              <ToolButton label="Download" icon={DownloadIcon} onClick={() => void downloadItem(item, filename)} />
              <ToolButton
                label={copied ? "Copied" : item.localPath ? "Copy path" : "Copy link"}
                icon={copied ? CheckIcon : CopyIcon}
                onClick={() => void copyLink()}
              />
              {canOpenExternal && (
                <ToolButton
                  label={item.localPath ? "Show in folder" : "Open in browser"}
                  icon={item.localPath ? FolderOpenIcon : ExternalLinkIcon}
                  onClick={openExternal}
                />
              )}
              {onRemove && (
                <ToolButton
                  label="Remove"
                  icon={Trash2Icon}
                  className="hover:bg-red-500/15 hover:text-red-300"
                  onClick={() => {
                    onRemove(index);
                    if (count <= 1) close();
                    else setIndex((i) => Math.min(i, count - 2));
                  }}
                />
              )}
              <span className="mx-1.5 h-5 w-px bg-white/15" aria-hidden />
              <ToolButton label="Close" icon={XIcon} onClick={close} />
            </div>
          </header>

          <div
            className={cn(
              "relative min-h-0 flex-1 px-4 pb-4 sm:px-16",
              zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden",
            )}
            onClick={close}
          >
            {zoomed ? <div className="flex min-h-full min-w-full w-max items-center justify-center">{stage}</div> : stage}
            {multi && !zoomed && (
              <>
                <NavButton side="left" onClick={() => go(-1)} />
                <NavButton side="right" onClick={() => go(1)} />
              </>
            )}
          </div>

          {multi && (
            <footer className="flex shrink-0 justify-center px-4 pb-4">
              <div className="flex max-w-full gap-2 overflow-x-auto rounded-xl bg-white/[0.06] p-2">
                {items.map((entry, at) => (
                  <Thumb key={`${entry.src}-${at}`} item={entry} active={at === index} onClick={() => setIndex(at)} />
                ))}
              </div>
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
