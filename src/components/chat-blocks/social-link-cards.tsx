"use client";

/**
 * Links to posts, videos and tracks (YouTube, TikTok, Instagram, X, …) in a
 * reply, as cards under it: the picture, the title and who posted it, the
 * way a chat app unfurls a link. What a card shows comes from the site's
 * oEmbed or its page (`link_preview`); its picture loads through the app.
 */
import { fetchPreview, useSiteImage, type LinkPreviewResult } from "@/components/link-preview";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";

type Platform = { name: string; color: string; video?: boolean; hosts: string[] };

/** The platforms a link unfurls for; anything else stays a plain link (with its hover card). */
const PLATFORMS: Platform[] = [
  { name: "YouTube", color: "#FF0033", video: true, hosts: ["youtube.com", "youtu.be", "music.youtube.com"] },
  { name: "TikTok", color: "#111111", video: true, hosts: ["tiktok.com", "vm.tiktok.com"] },
  { name: "Instagram", color: "#E1306C", hosts: ["instagram.com"] },
  { name: "Facebook", color: "#1877F2", hosts: ["facebook.com", "fb.com", "fb.watch"] },
  { name: "X", color: "#111111", hosts: ["x.com", "twitter.com"] },
  { name: "Threads", color: "#111111", hosts: ["threads.net", "threads.com"] },
  { name: "LinkedIn", color: "#0A66C2", hosts: ["linkedin.com"] },
  { name: "Pinterest", color: "#E60023", hosts: ["pinterest.com", "pin.it"] },
  { name: "Reddit", color: "#FF4500", hosts: ["reddit.com"] },
  { name: "Bluesky", color: "#1185FE", hosts: ["bsky.app"] },
  { name: "LINE", color: "#06C755", hosts: ["line.me", "linevoom.line.me"] },
  { name: "Vimeo", color: "#1AB7EA", video: true, hosts: ["vimeo.com"] },
  { name: "Dailymotion", color: "#0A0A0A", video: true, hosts: ["dailymotion.com", "dai.ly"] },
  { name: "Twitch", color: "#9146FF", video: true, hosts: ["twitch.tv"] },
  { name: "Spotify", color: "#1DB954", hosts: ["open.spotify.com"] },
  { name: "SoundCloud", color: "#FF5500", hosts: ["soundcloud.com"] },
  { name: "Behance", color: "#1769FF", hosts: ["behance.net"] },
  { name: "Dribbble", color: "#EA4C89", hosts: ["dribbble.com"] },
  { name: "Medium", color: "#111111", hosts: ["medium.com"] },
  { name: "Flickr", color: "#FF0084", hosts: ["flickr.com"] },
];

/** A reply rarely needs more; a list of fifty links shouldn't become fifty cards. */
const MAX_CARDS = 4;
const URL_PATTERN = /https:\/\/[^\s<>()[\]"'`]+/g;

function platformOf(url: string): Platform | undefined {
  let host: string;
  try {
    const parsed = new URL(url);
    // A channel's front page or the site itself isn't a post worth a card.
    if (parsed.pathname.replace(/\/+$/, "") === "") return undefined;
    host = parsed.host.toLowerCase().replace(/^(www|m|mobile)\./, "");
  } catch {
    return undefined;
  }
  return PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

/** The platform links in a reply, once each, in order. */
export function socialLinksOf(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    // Markdown and sentences leave punctuation on the end.
    const url = match[0].replace(/[.,;:!?*_~]+$/, "");
    if (!seen.has(url) && platformOf(url)) seen.add(url);
    if (seen.size >= MAX_CARDS) break;
  }
  return [...seen];
}

export function SocialLinkCards({ text, className }: { text: string; className?: string }) {
  const links = socialLinksOf(text);
  if (links.length === 0) return null;
  return (
    <div
      data-skip-markdown-delegate
      className={cn("grid w-full max-w-2xl gap-2", links.length > 1 && "sm:grid-cols-2", className)}
    >
      {links.map((url) => (
        <SocialLinkCard key={url} url={url} />
      ))}
    </div>
  );
}

function SocialLinkCard({ url }: { url: string }) {
  const platform = platformOf(url)!;
  const [result, setResult] = useState<LinkPreviewResult>();
  useEffect(() => {
    let live = true;
    void fetchPreview(url).then((next) => live && setResult(next));
    return () => {
      live = false;
    };
  }, [url]);
  const data = result && "data" in result ? result.data : undefined;
  const image = useSiteImage(data?.image ?? undefined);
  const loading = result === undefined;
  const title = data?.title?.trim() || data?.description?.trim() || url.replace(/^https:\/\/(www\.)?/, "");
  const byline = data?.author?.trim() || (data?.title ? data?.description?.trim() : undefined);

  return (
    <button
      type="button"
      onClick={() => void openUrl(url)}
      title={url}
      className="group/social flex min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden bg-muted",
          platform.video ? "aspect-video w-36" : "aspect-square w-24",
        )}
      >
        {image.src ? (
          <img src={image.src} alt="" draggable={false} className="size-full object-cover" />
        ) : loading || (data?.image && !image.failed) ? (
          <span className="size-full animate-pulse bg-muted" />
        ) : (
          <span className="text-lg font-semibold text-white/95" style={{ color: platform.color }}>
            {platform.name.slice(0, 1)}
          </span>
        )}
        {platform.video && image.src && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover/social:bg-black/25">
            <span className="flex size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
              <PlayIcon className="size-3.5 translate-x-px fill-current" />
            </span>
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: platform.color }} />
          {data?.siteName?.trim() || platform.name}
          <ExternalLinkIcon className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover/social:opacity-100" />
        </span>
        {loading ? (
          <>
            <span className="mt-0.5 h-3.5 w-4/5 animate-pulse rounded bg-muted" />
            <span className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
          </>
        ) : (
          <>
            <span className="line-clamp-2 text-[13px] leading-snug font-medium break-words">{title}</span>
            {byline && <span className="truncate text-xs text-muted-foreground">{byline}</span>}
          </>
        )}
      </span>
    </button>
  );
}
