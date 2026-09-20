"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GlobeIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type LinkPreviewData = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
};

const cache = new Map<string, LinkPreviewData | null>();

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  try {
    const data = await invoke<LinkPreviewData>("link_preview", { url });
    cache.set(url, data);
    return data;
  } catch {
    cache.set(url, null);
    return null;
  }
}

type LinkPreviewCardProps = {
  href: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
};

/** A link that shows site title, description and thumbnail on hover. */
export function LinkPreviewCard({ href, children, className, side = "top" }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<LinkPreviewData | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const loading = useRef(false);

  useEffect(() => {
    if (!open || preview !== undefined || loading.current) return;
    loading.current = true;
    void fetchPreview(href).then((data) => {
      setPreview(data);
      loading.current = false;
    });
  }, [open, href, preview]);

  return (
    <HoverCard openDelay={350} closeDelay={80} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => void openUrl(href)}
          className={cn(
            "inline text-left font-medium underline underline-offset-2 hover:opacity-90 break-all",
            className,
          )}
        >
          {children}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side={side} align="start" className="w-80 overflow-hidden p-0">
        <PreviewBody href={href} preview={preview} />
      </HoverCardContent>
    </HoverCard>
  );
}

function PreviewBody({ href, preview }: { href: string; preview: LinkPreviewData | null | undefined }) {
  if (preview === undefined) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        Loading preview…
      </div>
    );
  }

  const title = preview?.title?.trim() || preview?.siteName?.trim() || hostOf(href);
  const description = preview?.description?.trim();
  const image = preview?.image?.trim();

  return (
    <div className="flex flex-col">
      {image ? (
        <div className="relative aspect-[1.91/1] w-full overflow-hidden bg-muted">
          <img src={image} alt="" className="size-full object-cover" loading="lazy" />
        </div>
      ) : (
        <div className="flex aspect-[1.91/1] items-center justify-center bg-muted/60">
          <GlobeIcon className="size-8 text-muted-foreground/50" />
        </div>
      )}
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{title}</p>
        {description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
        <p className="truncate text-[11px] text-muted-foreground/80">{hostOf(href)}</p>
      </div>
    </div>
  );
}
