"use client";

import { loadImage } from "@/components/chat-blocks/gallery-card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, GlobeIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type LinkPreviewData = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
  /** Who posted it (a channel, an account), when the site says. */
  author?: string | null;
};

export type LinkPreviewResult = { data: LinkPreviewData } | { error: string };
type Result = LinkPreviewResult;

const cache = new Map<string, Result>();
// Two links to the same page in one reply is common; fetch it once.
const inFlight = new Map<string, Promise<Result>>();

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The site's own icon — no third party learns which links are hovered. */
function faviconOf(url: string) {
  try {
    return new URL("/favicon.ico", url).toString();
  } catch {
    return undefined;
  }
}

export function fetchPreview(url: string): Promise<Result> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(url);
  if (running) return running;

  const promise = invoke<LinkPreviewData>("link_preview", { url })
    .then((data): Result => ({ data }))
    .catch((error): Result => ({
      error: error instanceof Error ? error.message : String(error || "Couldn't reach this site"),
    }))
    .then((result) => {
      // Failures aren't cached: the next hover is a free retry after a
      // dropped connection or a site that was briefly down.
      if ("data" in result) cache.set(url, result);
      inFlight.delete(url);
      return result;
    });

  inFlight.set(url, promise);
  return promise;
}

type LinkPreviewCardProps = {
  href: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
};

/** A link that shows site title, description and thumbnail on hover. */
export function LinkPreviewCard({ href, children, className, side = "top" }: LinkPreviewCardProps) {
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const loading = useRef(false);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    setResult(undefined);
    void fetchPreview(href).then((next) => {
      setResult(next);
      loading.current = false;
    });
  }, [href]);

  useEffect(() => {
    if (open && result === undefined && !loading.current) load();
  }, [open, result, load]);

  return (
    <HoverCard openDelay={350} closeDelay={120} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => void openUrl(href)}
          className={cn(
            "inline break-all text-left font-medium underline underline-offset-2 hover:opacity-90",
            className,
          )}
        >
          {children}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align="start"
        collisionPadding={12}
        className="w-80 overflow-hidden p-0"
      >
        <PreviewBody href={href} result={result} onRetry={load} />
      </HoverCardContent>
    </HoverCard>
  );
}

function PreviewBody({
  href,
  result,
  onRetry,
}: {
  href: string;
  result: Result | undefined;
  onRetry: () => void;
}) {
  if (result === undefined) return <PreviewSkeleton href={href} />;

  if ("error" in result) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="flex items-center gap-2">
          <Favicon href={href} />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{hostOf(href)}</p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          No preview — {result.error.replace(/\.$/, "")}.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <RotateCcwIcon className="size-3" />
            Try again
          </button>
          <OpenLink href={href} />
        </div>
      </div>
    );
  }

  const preview = result.data;
  const title = preview.title?.trim() || preview.siteName?.trim() || hostOf(href);
  const description = preview.description?.trim();
  const image = preview.image?.trim();

  return (
    <div className="flex flex-col">
      <PreviewImage src={image} />
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{title}</p>
        {description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <Favicon href={href} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
            {hostOf(href)}
          </span>
          <OpenLink href={href} />
        </div>
      </div>
    </div>
  );
}

function PreviewSkeleton({ href }: { href: string }) {
  return (
    <div className="flex flex-col">
      <div className="aspect-[1.91/1] w-full animate-pulse bg-muted/70" />
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted/70" />
        <div className="flex items-center gap-2 pt-0.5">
          <Favicon href={href} />
          <span className="truncate text-[11px] text-muted-foreground/80">{hostOf(href)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * A site's picture as the page can draw it: the app fetches it (other hosts
 * aren't in the page's policy), as for gallery pages.
 */
export function useSiteImage(url: string | undefined) {
  const [state, setState] = useState<{ src?: string; failed?: boolean }>({});
  useEffect(() => {
    if (!url) return setState({ failed: true });
    let live = true;
    setState({});
    loadImage(url).then(
      (src) => live && setState({ src }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

/** The card's picture, replaced by a placeholder when it 404s or is blocked. */
function PreviewImage({ src: url }: { src?: string }) {
  const image = useSiteImage(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const src = image.src;

  if (!url || image.failed || failed) {
    return (
      <div className="flex aspect-[1.91/1] items-center justify-center bg-muted/60">
        <GlobeIcon className="size-8 text-muted-foreground/50" />
      </div>
    );
  }
  return (
    <div className="relative aspect-[1.91/1] w-full overflow-hidden bg-muted">
      {src ? (
        <img src={src} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <div className="size-full animate-pulse bg-muted/70" />
      )}
    </div>
  );
}

function Favicon({ href }: { href: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconOf(href);
  if (!src || failed) return <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/70" />;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-3.5 shrink-0 rounded-sm object-contain"
    />
  );
}

function OpenLink({ href }: { href: string }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(href)}
      className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      Open
      <ExternalLinkIcon className="size-2.5" aria-hidden />
    </button>
  );
}
