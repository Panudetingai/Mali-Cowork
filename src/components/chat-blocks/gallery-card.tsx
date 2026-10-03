"use client";

import type { GalleryBlock, GalleryItem } from "@/features/chat-blocks";
import { connectorFor, McpToolIcon, useCustomMcps } from "@/features/mcp";
import { cn } from "@/lib/utils";
import { Figma, Github, Google, Notion } from "@lobehub/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ImageOffIcon, LayoutGridIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MediaPreviewDialog } from "./media-preview-dialog";
import { useProxiedImage } from "./use-proxied-image";

/** Tiles share one height; each is as wide as its page's shape needs. */
const TILE_HEIGHT = 184;
/** Until a picture tells its size: a slide is 16:9. */
const DEFAULT_RATIO = 16 / 9;

/** The Canva mark: its gradient disc with a white C. */
function CanvaMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="canva-mark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#00C4CC" />
          <stop offset="0.5" stopColor="#5A32FA" />
          <stop offset="1" stopColor="#7D2AE8" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#canva-mark)" />
      <text x="12" y="16.6" textAnchor="middle" fontSize="13" fontWeight="700" fontStyle="italic" fill="#fff" fontFamily="Georgia, serif">
        C
      </text>
    </svg>
  );
}

const SOURCES: Record<string, { label: string; icon: ReactNode }> = {
  canva: { label: "Canva", icon: <CanvaMark /> },
  notion: { label: "Notion", icon: <Notion size={18} /> },
  figma: { label: "Figma", icon: <Figma size={18} /> },
  "google-slides": { label: "Google Slides", icon: <Google size={18} /> },
  "google-docs": { label: "Google Docs", icon: <Google size={18} /> },
  google: { label: "Google", icon: <Google size={18} /> },
  github: { label: "GitHub", icon: <Github size={18} /> },
};

/** The app a gallery lives in: its name and mark (also used by the notch). */
export function sourceOf(source: string | undefined) {
  const key = (source ?? "").replace(/[\s_]+/g, "-");
  const known = SOURCES[key];
  if (known) return known;
  const label = source ? source.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Preview";
  return { label, icon: <LayoutGridIcon className="size-[18px] text-muted-foreground" /> };
}

function Tile({
  item,
  index,
  onOpen,
  onLoaded,
  source,
  href,
}: {
  item: GalleryItem;
  index: number;
  onOpen: () => void;
  onLoaded: (index: number, src: string) => void;
  /** The app's name, for "Open in Canva" when the picture can't load. */
  source: string;
  /** Opens this page (or the whole design) in its app. */
  href?: string;
}) {
  const remote = useProxiedImage(item.image);
  // A picture that loaded as data but won't draw counts as failed too.
  const [broken, setBroken] = useState(false);
  const src = broken ? undefined : remote.src;
  const failed = broken || remote.failed;
  const [natural, setNatural] = useState<number>();
  const ratio = item.width && item.height ? item.width / item.height : (natural ?? DEFAULT_RATIO);
  // Very tall or wide pictures are held to a sensible tile.
  const width = Math.round(TILE_HEIGHT * Math.min(Math.max(ratio, 0.5), 2.4));

  useEffect(() => {
    if (src) onLoaded(index, src);
  }, [src, index, onLoaded]);

  return (
    <button
      type="button"
      // A picture whose link expired opens the design in its app instead.
      onClick={src ? onOpen : failed && href ? () => void openUrl(href) : undefined}
      disabled={!src && !(failed && href)}
      title={item.title ?? `Page ${index + 1}`}
      style={{ width, height: TILE_HEIGHT }}
      className={cn(
        "group/tile relative shrink-0 snap-start overflow-hidden rounded-xl border border-border/60 bg-muted/40 shadow-xs transition",
        (src || (failed && href)) &&
          "hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      {src ? (
        <img
          src={src}
          alt={item.title ?? `Page ${index + 1}`}
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w && h) setNatural(w / h);
          }}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : failed ? (
        <span className="flex size-full flex-col items-center justify-center gap-1.5 px-3 text-center text-[11px] text-muted-foreground">
          <ImageOffIcon className="size-4" />
          {href ? (
            <>
              <span>The preview link expired</span>
              <span className="flex items-center gap-1 font-medium text-foreground/80 group-hover/tile:text-foreground">
                Open in {source}
                <ExternalLinkIcon className="size-3" />
              </span>
            </>
          ) : (
            "Preview unavailable"
          )}
        </span>
      ) : (
        <span className="block size-full animate-pulse bg-muted" />
      )}
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums backdrop-blur-sm">
        {index + 1}
      </span>
      {item.title && src && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-6 pb-2 pl-8 text-left text-[11px] font-medium text-white opacity-0 transition-opacity group-hover/tile:opacity-100">
          {item.title}
        </span>
      )}
    </button>
  );
}

function ArrowButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={cn(
        "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/95 text-foreground shadow-md transition hover:scale-105",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/**
 * Slides, pages or frames from another app as a strip of previews, like the
 * app's own "your designs" row: one height, each page its own shape
 * (portrait, landscape or square), arrows when there's more, and a click
 * for the full-size view.
 */
export function GalleryCard({ gallery }: { gallery: GalleryBlock }) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [loaded, setLoaded] = useState<Record<number, string>>({});
  const [openAt, setOpenAt] = useState<number | null>(null);
  // The connector the user installed wins: its own icon and name match the
  // step rows above. The built-in marks are only a fallback.
  useCustomMcps();
  const connector = connectorFor(gallery.source, gallery.connector);
  const fallback = sourceOf(gallery.source);
  const source = connector
    ? { label: connector.serverName, icon: <McpToolIcon mcp={connector} size={18} className="rounded" /> }
    : fallback;
  const count = gallery.items.length;

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = strip.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const onLoaded = useCallback((index: number, src: string) => {
    setLoaded((prev) => (prev[index] === src ? prev : { ...prev, [index]: src }));
    requestAnimationFrame(measure);
  }, [measure]);

  const scroll = (direction: 1 | -1) => {
    const el = strip.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  // The lightbox shows the pictures already fetched, in page order.
  const viewable = gallery.items
    .map((item, index) => ({ index, src: loaded[index], title: item.title ?? `${source.label} · ${index + 1}` }))
    .filter((entry): entry is { index: number; src: string; title: string } => !!entry.src);

  return (
    <div className="not-prose flex w-full min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-[18px] shrink-0 items-center justify-center">{source.icon}</span>
        <span className="shrink-0 text-sm font-medium">{source.label}</span>
        {gallery.title && <span className="min-w-0 truncate text-sm text-muted-foreground">· {gallery.title}</span>}
        <span className="shrink-0 text-xs text-muted-foreground">
          · {count} {count === 1 ? "page" : "pages"}
        </span>
        {gallery.url && (
          <a
            href={gallery.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Open in {source.label}
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>

      <div className="relative">
        <div
          ref={strip}
          onScroll={measure}
          className={cn(
            "scroll-hidden flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth py-1",
            // Fade the edge that has more beyond it, like the source apps do.
            !edges.end && !edges.start && "[mask-image:linear-gradient(to_right,transparent,black_48px,black_calc(100%-72px),transparent)]",
            !edges.end && edges.start && "[mask-image:linear-gradient(to_right,black_calc(100%-72px),transparent)]",
            edges.end && !edges.start && "[mask-image:linear-gradient(to_right,transparent,black_48px)]",
          )}
        >
          {gallery.items.map((item, index) => (
            <Tile
              key={`${item.image}-${index}`}
              item={item}
              index={index}
              onLoaded={onLoaded}
              onOpen={() => setOpenAt(index)}
              source={source.label}
              href={item.url ?? gallery.url}
            />
          ))}
        </div>
        {!edges.start && <ArrowButton side="left" onClick={() => scroll(-1)} />}
        {!edges.end && <ArrowButton side="right" onClick={() => scroll(1)} />}
      </div>

      {/* Mounted per opening, so it starts on the page that was clicked. */}
      {openAt !== null && (
        <MediaPreviewDialog
          open
          onOpenChange={(open) => !open && setOpenAt(null)}
          items={viewable.map((entry) => ({ src: entry.src, title: entry.title, kind: "image" as const }))}
          initialIndex={Math.max(0, viewable.findIndex((entry) => entry.index === openAt))}
        />
      )}
    </div>
  );
}
