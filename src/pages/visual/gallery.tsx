import { Button } from "@/components/ui/button";
import {
  dismissVisualJob,
  removeVisualItem,
  retryVisualJob,
  type VisualItem,
  type VisualJob,
} from "@/features/visual";
import { cn } from "@/lib/utils";
import { readFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertCircleIcon, FolderOpenIcon, RotateCcwIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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

function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Ticks once a second while something is being made. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** One card per file a job was asked for, until the files arrive. */
function PendingCard({ job, index }: { job: VisualJob; index: number }) {
  const now = useNow(!job.error);
  const failed = Boolean(job.error);
  // The details go on the first card; the others are just placeholders.
  const lead = index === 0;

  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card",
        failed && "border-destructive/30",
      )}
    >
      <div className="relative flex aspect-square flex-col items-center justify-center gap-3 overflow-hidden bg-muted/30 px-5 text-center">
        {failed ? (
          lead ? (
            <>
              <AlertCircleIcon className="size-5 text-destructive" />
              <p className="line-clamp-4 text-xs leading-relaxed text-destructive">{job.error}</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => retryVisualJob(job.id)}>
                  <RotateCcwIcon className="size-3" /> Try again
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismissVisualJob(job.id)}>
                  Dismiss
                </Button>
              </div>
            </>
          ) : null
        ) : (
          <>
            {/* A slow sweep says "working" without a spinner in every card. */}
            <motion.div
              aria-hidden
              className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent"
              animate={{ x: ["0%", "300%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: index * 0.2 }}
            />
            <motion.span
              animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              className="flex size-9 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400"
            >
              <SparklesIcon className="size-4" />
            </motion.span>
            {lead && (
              <div className="relative flex flex-col gap-1">
                <p className="text-xs font-medium">{job.step ?? `Starting ${job.modelName}…`}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {elapsed(now - job.startedAt)}
                  {job.kind === "video" ? " · videos can take a few minutes" : ""}
                </p>
              </div>
            )}
          </>
        )}
      </div>
      <figcaption className="flex items-start gap-2 px-3 py-2.5">
        <p className="min-w-0 flex-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={job.prompt}>
          {job.prompt}
        </p>
        {lead && !failed && (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
            title="Hide — the files still arrive in the gallery"
            aria-label="Hide"
            onClick={() => dismissVisualJob(job.id)}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </figcaption>
    </figure>
  );
}

export function VisualGallery({
  items,
  jobs = [],
  className,
}: {
  items: VisualItem[];
  /** Being made: shown first, as placeholders. */
  jobs?: VisualJob[];
  className?: string;
}) {
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
      <AnimatePresence initial={false} mode="popLayout">
        {jobs.flatMap((job) =>
          // A failed job needs one card for its message, not one per file.
          Array.from({ length: job.error ? 1 : Math.max(1, job.count) }, (_, index) => (
            <motion.div
              key={`${job.id}-${index}`}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: "easeOut", delay: index * 0.05 }}
            >
              <PendingCard job={job} index={index} />
            </motion.div>
          )),
        )}
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.2), ease: "easeOut" }}
          >
            <Card item={item} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
