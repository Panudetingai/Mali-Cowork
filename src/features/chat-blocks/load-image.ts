/**
 * Pictures from the web (an agent's markdown, Canva, Notion…) can't load
 * straight into the webview: the app's content policy only allows its own
 * images. The backend fetches each one (`preview_image`: https, public hosts,
 * images only, kept on disk because the links expire) and hands back a data
 * URL. Cached for the session so scrolling back doesn't refetch.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** What `preview_image` takes: a public https link or a `mali-preview:` handle. */
export function needsProxy(src: string) {
  return isTauri() && (/^https:\/\//i.test(src) || src.startsWith("mali-preview:"));
}

const fetched = new Map<string, Promise<string>>();

export function loadImage(url: string): Promise<string> {
  if (!needsProxy(url)) return Promise.resolve(url);
  let pending = fetched.get(url);
  if (!pending) {
    pending = invoke<string>("preview_image", { url });
    // A failure isn't kept: the next render may try again.
    pending.catch(() => fetched.delete(url));
    fetched.set(url, pending);
  }
  return pending;
}

/** Drop a picture from the session cache, for Retry. */
export function forgetImage(url: string) {
  fetched.delete(url);
}
