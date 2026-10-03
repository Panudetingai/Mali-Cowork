/**
 * What a run made, in the notch: a strip of its pages or pictures (they
 * arrive one by one as the agent makes them), and a viewer over the pill for
 * a closer look. Pictures from Canva and the like load through the app, as
 * in the chat (`gallery-card.tsx`): their hosts aren't in the page's policy.
 */
import { sourceOf } from "@/components/chat-blocks/gallery-card";
import { loadImage } from "@/features/chat-blocks/load-image";
import { useLocalMedia } from "@/components/chat-blocks/media-preview-card";
import { connectorFor, McpToolIcon, useCustomMcps } from "@/features/mcp";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ImageOffIcon, ImagesIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNotchText } from "./text";
import type { NotchShowcase, NotchShowcaseItem } from "./types";

/** Until a picture tells its size: a slide is 16:9. */
const DEFAULT_RATIO = 16 / 9;

type Viewing = { showcase: NotchShowcase; index: number };

const ViewerContext = createContext<(viewing: Viewing) => void>(() => {});

/**
 * Where the viewer opens: over the pill's whole body, inside its shape.
 * It closes when the pill changes view (`resetKey`).
 */
export function ShowcaseViewerHost({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [viewing, setViewing] = useState<Viewing | null>(null);
  useEffect(() => setViewing(null), [resetKey]);
  return (
    <ViewerContext.Provider value={setViewing}>
      {children}
      <AnimatePresence>
        {viewing && (
          <Viewer
            key="viewer"
            viewing={viewing}
            onIndex={(index) => setViewing({ ...viewing, index })}
            onClose={() => setViewing(null)}
          />
        )}
      </AnimatePresence>
    </ViewerContext.Provider>
  );
}

const loaded = new Map<string, string>();

/** A picture's address the page can draw: fetched by the app, or read from disk. */
function useItemImage(item: NotchShowcaseItem) {
  const local = useLocalMedia(item.local ? item.image : undefined);
  const [remote, setRemote] = useState<{ src?: string; failed?: boolean }>(() => ({ src: loaded.get(item.image) }));
  useEffect(() => {
    if (item.local) return;
    const known = loaded.get(item.image);
    if (known) return setRemote({ src: known });
    let live = true;
    setRemote({});
    loadImage(item.image).then(
      (src) => {
        loaded.set(item.image, src);
        if (live) setRemote({ src });
      },
      () => live && setRemote({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [item.image, item.local]);
  return item.local ? { src: local.url, failed: local.failed } : remote;
}

/**
 * The app it lives in: the connector the user installed wins, with its own
 * icon and name (as in the chat's gallery and the step rows); the built-in
 * marks are only a fallback.
 */
function useLabel(showcase: NotchShowcase, picturesLabel: string) {
  useCustomMcps();
  if (!showcase.source && !showcase.connector)
    return { label: picturesLabel, icon: <ImagesIcon className="size-3.5 text-white/60" /> };
  const connector = connectorFor(showcase.source, showcase.connector);
  if (connector)
    return { label: connector.serverName, icon: <McpToolIcon mcp={connector} size={16} className="rounded" /> };
  return sourceOf(showcase.source);
}

/** A strip of what was made: its app, its name, and each page in its own shape. */
export function Showcase({
  showcase,
  height = 84,
  className,
}: {
  showcase: NotchShowcase;
  height?: number;
  className?: string;
}) {
  const t = useNotchText();
  const view = useContext(ViewerContext);
  const source = useLabel(showcase, t("pictures"));
  const count = showcase.items.length;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
        <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{source.icon}</span>
        <span className="shrink-0 font-medium text-white/85">{source.label}</span>
        {showcase.title && <span className="min-w-0 truncate text-white/45">· {showcase.title}</span>}
        <span className="shrink-0 text-white/35">· {count === 1 ? t("onePage") : t("pages", { n: count })}</span>
        {showcase.url && (
          <button
            type="button"
            onClick={() => void openUrl(showcase.url!)}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[11.5px] text-white/75 transition-colors hover:bg-white/[0.16] hover:text-white"
          >
            {t("openIn", { app: source.label })}
            <ExternalLinkIcon className="size-3" />
          </button>
        )}
      </div>
      <div className="scroll-hidden -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
        <AnimatePresence initial={false}>
          {showcase.items.map((item, index) => (
            <Tile
              key={`${item.image}-${index}`}
              item={item}
              index={index}
              height={height}
              onOpen={() => view({ showcase, index })}
              href={showcase.url}
              app={source.label}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Tile({
  item,
  index,
  height,
  onOpen,
  href,
  app,
}: {
  item: NotchShowcaseItem;
  index: number;
  height: number;
  onOpen: () => void;
  /** Opens the design in its app: what an expired picture does instead. */
  href?: string;
  app: string;
}) {
  const t = useNotchText();
  const image = useItemImage(item);
  const [natural, setNatural] = useState<number>();
  const [broken, setBroken] = useState(false);
  const ratio = item.width && item.height ? item.width / item.height : (natural ?? DEFAULT_RATIO);
  const width = Math.round(height * Math.min(Math.max(ratio, 0.5), 2.2));
  const src = broken ? undefined : image.src;
  const failed = !src && (image.failed || broken);
  return (
    <motion.button
      type="button"
      layout
      onClick={src ? onOpen : failed && href ? () => void openUrl(href) : undefined}
      disabled={!src && !(failed && href)}
      title={item.title ?? `${index + 1}`}
      // Each page arrives as it's made: it pops into the strip.
      initial={{ opacity: 0, scale: 0.8, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 30, delay: Math.min(index, 6) * 0.05 }}
      whileHover={src || (failed && href) ? { y: -2 } : undefined}
      style={{ width, height }}
      className="group/tile relative shrink-0 overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/10"
    >
      {src ? (
        <motion.img
          src={src}
          alt={item.title ?? ""}
          draggable={false}
          className="size-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w && h) setNatural(w / h);
          }}
          onError={() => setBroken(true)}
        />
      ) : failed ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-[10.5px] text-white/40">
          <ImageOffIcon className="size-3.5" />
          {href ? (
            <>
              <span>{t("previewExpired")}</span>
              <span className="flex items-center gap-0.5 font-medium text-white/70 group-hover/tile:text-white">
                {app}
                <ExternalLinkIcon className="size-2.5" />
              </span>
            </>
          ) : (
            t("noPreview")
          )}
        </span>
      ) : (
        <span className="block size-full animate-pulse bg-white/[0.06]" />
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 text-[10px] leading-4 font-medium text-white/90 tabular-nums">
        {index + 1}
      </span>
    </motion.button>
  );
}

/** One page large, over the pill: arrows (or ← →) between pages, Esc or × to close. */
function Viewer({
  viewing,
  onIndex,
  onClose,
}: {
  viewing: Viewing;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const t = useNotchText();
  const { showcase, index } = viewing;
  const count = showcase.items.length;
  const item = showcase.items[Math.min(index, count - 1)];
  const image = useItemImage(item);
  const source = useLabel(showcase, t("pictures"));
  const [direction, setDirection] = useState(1);
  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= count) return;
    setDirection(step);
    onIndex(next);
  };
  const goRef = useLatest(go);
  const closeRef = useLatest(onClose);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      else if (event.key === "ArrowLeft") goRef.current(-1);
      else if (event.key === "ArrowRight") goRef.current(1);
      else return;
      // Before the ask box hears it: Esc closes the viewer, not the notch.
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [goRef, closeRef]);

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <div
        className="flex shrink-0 items-center gap-2 px-4 pt-2.5 pb-1.5 text-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex size-4 items-center justify-center [&_svg]:size-4">{source.icon}</span>
        <span className="min-w-0 truncate font-medium text-white/85">
          {item.title ?? showcase.title ?? source.label}
        </span>
        <span className="shrink-0 text-white/40 tabular-nums">
          {index + 1} / {count}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {showcase.url && (
            <button
              type="button"
              onClick={() => void openUrl(showcase.url!)}
              className="flex items-center gap-1 rounded-full bg-white/[0.1] px-2.5 py-0.5 text-[11.5px] text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
            >
              {t("openIn", { app: source.label })}
              <ExternalLinkIcon className="size-3" />
            </button>
          )}
          <button
            type="button"
            title={t("close")}
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 px-12 pb-3" onClick={(e) => e.stopPropagation()}>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={index}
            className="absolute inset-0 flex items-center justify-center px-12 pb-3"
            custom={direction}
            initial={{ opacity: 0, x: direction * 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: direction * -40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            {image.src ? (
              <img
                src={image.src}
                alt={item.title ?? ""}
                draggable={false}
                className="max-h-full max-w-full rounded-lg object-contain shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
              />
            ) : image.failed ? (
              <span className="flex flex-col items-center gap-1.5 text-[12px] text-white/45">
                <ImageOffIcon className="size-5" />
                {t("noPreview")}
              </span>
            ) : (
              <span className="size-16 animate-pulse rounded-xl bg-white/[0.08]" />
            )}
          </motion.div>
        </AnimatePresence>
        {index > 0 && <Arrow side="left" onClick={() => go(-1)} label={t("previous")} />}
        {index < count - 1 && <Arrow side="right" onClick={() => go(1)} label={t("next")} />}
      </div>
    </motion.div>
  );
}

function Arrow({ side, onClick, label }: { side: "left" | "right"; onClick: () => void; label: string }) {
  const Icon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.1] text-white/80 transition hover:scale-105 hover:bg-white/[0.18] hover:text-white",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
