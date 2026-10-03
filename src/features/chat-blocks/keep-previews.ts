/**
 * Keep the pictures a reply shows of what it made (a Canva design's pages,
 * pictures it found): their links are signed and expire within minutes, so
 * the app fetches them as soon as the reply ends and keeps them on disk
 * (`preview_image`). The chat, the notch and the Inbox then show them later.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { extractChatBlocks } from "./parse";

/** At most this many at once: a deck of fifty pages shouldn't flood the network. */
const AT_ONCE = 4;

/** `![alt](https://…)` or `![alt](<mali-preview:…> "title")` in a reply's markdown. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?((?:https:\/\/|mali-preview:)[^\s)>]+)>?/g;

export function keepPreviews(content: string) {
  if (!isTauri()) return;
  const blocks = content.includes("```") ? extractChatBlocks(content) : { galleries: [], mediaPreviews: [] };
  const links = [
    ...blocks.galleries.flatMap((g) => g.items.map((item) => item.image)),
    ...blocks.mediaPreviews.filter((m) => m.kind === "image" && !m.local).map((m) => m.thumbnail ?? m.url),
    // Plain markdown pictures (generated images often come this way) expire too.
    ...[...content.matchAll(MARKDOWN_IMAGE)].map((m) => m[1]!),
  ].filter((url) => url.startsWith("https://") || url.startsWith("mali-preview:"));
  if (!links.length) return;
  const queue = [...new Set(links)];
  const next = async (): Promise<void> => {
    const url = queue.shift();
    if (!url) return;
    await invoke("preview_image", { url }).catch(() => undefined);
    return next();
  };
  for (let i = 0; i < AT_ONCE; i++) void next();
}
