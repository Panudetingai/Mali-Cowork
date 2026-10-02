/**
 * A still picture of a cowork bot, for places that show many at once (the
 * notch's team chips): the bot's own drawing, taken once from its animation
 * and kept as an image. No animation loop and no page per bot — one hidden
 * frame loads, gives up its drawing, and goes.
 */
import type { CoworkBotId } from "@/features/cowork-bot";
import { useEffect, useSyncExternalStore } from "react";
import { EMBED_VERSION } from "./cowork-bot";

const pictures = new Map<CoworkBotId, string>();
const loading = new Map<CoworkBotId, Promise<void>>();
const listeners = new Set<() => void>();
/** Long enough for the drawing to appear; past this, the flat face stays. */
const GIVE_UP_MS = 4000;

/** The bot's drawing (SVG) as an image: page variables don't reach an image, so they get their dark-theme values. */
export function svgPicture(svg: SVGSVGElement) {
  let markup = new XMLSerializer()
    .serializeToString(svg)
    .replace(/var\(--shadow\)/g, "rgba(0,0,0,0.25)")
    .replace(/var\(--muted\)/g, "#9a9aa5");
  if (!markup.includes('xmlns="http://www.w3.org/2000/svg"')) {
    markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function take(bot: CoworkBotId): Promise<void> {
  const pending = loading.get(bot);
  if (pending) return pending;
  const done = new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = `/anim/cowork-bots.html?embed=${bot}&shadow=0&state=idle&theme=dark&v=${EMBED_VERSION}`;
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-400px;top:-400px;width:160px;height:160px;border:0;opacity:0;pointer-events:none";
    const started = performance.now();
    const finish = () => {
      frame.remove();
      resolve();
    };
    const look = () => {
      const svg = frame.contentDocument?.querySelector<SVGSVGElement>("#embed svg");
      // Drawn once its colors are in: they're set with its first frame.
      if (svg?.querySelector("stop[stop-color]")) {
        pictures.set(bot, svgPicture(svg));
        listeners.forEach((listener) => listener());
        return finish();
      }
      if (performance.now() - started > GIVE_UP_MS) return finish();
      setTimeout(look, 80);
    };
    // Paused, it draws one frame at once: no waiting on an animation loop
    // the browser may not run for a frame it can't see.
    frame.onload = () => {
      frame.contentWindow?.postMessage({ state: "idle", paused: true }, "*");
      setTimeout(look, 60);
    };
    frame.onerror = finish;
    document.body.appendChild(frame);
  });
  loading.set(bot, done);
  return done;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The bot's picture as an image URL; undefined until it's taken (the first time only). */
export function useBotPicture(bot: CoworkBotId) {
  const picture = useSyncExternalStore(subscribe, () => pictures.get(bot));
  useEffect(() => {
    if (!pictures.has(bot)) void take(bot);
  }, [bot]);
  return picture;
}
