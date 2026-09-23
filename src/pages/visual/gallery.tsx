import { Button } from "@/components/ui/button";
import { removeVisualItem, type VisualItem } from "@/features/visual";
import { cn } from "@/lib/utils";
import { readFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpenIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ZoomableImage } from "@/components/chat-blocks/zoomable-image";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/**
 * A blob URL for a file on this computer: the webview cannot load `file://`
 * from an app page, so generated media is read through the file API.
 */
function useLocalFile(path: string) {
  const [state, setState] = useState<{ url?: string; missing?: boolean }>({});

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    const type = MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
    readFile(path)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
        setState({ url: objectUrl });
      })
      // Deleted or moved since it was made: the card says so rather than
      // showing a broken frame.
      .catch(() => !cancelled && setState({ missing: true }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return state;
}

function Card({ item }: { item: VisualItem }) {
  const file = useLocalFile(item.path);

  return (
    <figure className="group relative overflow-hidden rounded-2xl border bg-card">
      <div className="flex aspect-square items-center justify-center bg-muted/30">
        {file.missing ? (
          <p className="px-4 text-center text-xs text-muted-foreground">
            This file is no longer there
          </p>
        ) : !file.url ? (
          <div className="size-full animate-pulse bg-muted/60" />
        ) : item.kind === "video" ? (
          <video src={file.url} controls playsInline preload="metadata" className="size-full object-contain" />
        ) : (
          <ZoomableImage src={file.url} alt={item.prompt} imageClassName="size-full object-cover" />
        )}
      </div>

      <figcaption className="flex items-start gap-2 px-3 py-2.5">
        <p className="min-w-0 flex-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={item.prompt}>
          {item.prompt}
        </p>
      </figcaption>

      {/* Kept off the card until it is wanted: the picture is the point. */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="rounded-full shadow"
          title="Show in folder"
          onClick={() => void revealItemInDir(item.path)}
        >
          <FolderOpenIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="rounded-full shadow"
          title="Remove from this list (the file stays on disk)"
          onClick={() => removeVisualItem(item.id)}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </figure>
  );
}

const EMPTY_TITLE: Record<"image" | "video", string> = {
  image: "Image Creation",
  video: "Video Creation",
};

/** Shown while the gallery for this kind has nothing yet — parent centers it. */
export function VisualEmptyWelcome({ kind }: { kind: "image" | "video" }) {
  return (
    <motion.div
      key={kind}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-xl px-4 text-center"
    >
      <p className="text-2xl leading-relaxed text-muted-foreground sm:text-3xl">
        Welcome to{" "}
        <motion.span
          key={kind}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="font-semibold text-foreground"
        >
          {EMPTY_TITLE[kind]}
        </motion.span>
        {" — "}what would you like to create today?
      </p>
    </motion.div>
  );
}

export function VisualGallery({ items, className }: { items: VisualItem[]; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {items.map((item, index) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.2), ease: "easeOut" }}
        >
          <Card item={item} />
        </motion.div>
      ))}
    </motion.div>
  );
}
