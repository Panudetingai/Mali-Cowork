import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";

/**
 * Icons the user chose for connectors, by connector id, as `data:` URLs.
 * Uploads are shrunk to a small PNG; links are fetched once by the backend,
 * since the webview may only show images from a few hosts.
 */
const store = createStore<Record<string, string>>({}, {
  key: "mcp_icon_overrides",
  revive: (value) =>
    value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string" && e[1].startsWith("data:image/"),
          ),
        )
      : {},
});

export const useConnectorIcons = store.use;

/** The icon the user picked for this connector, if any. */
export function useConnectorIcon(id: string | undefined) {
  const icons = store.use();
  return id ? icons[id] : undefined;
}

export function getConnectorIcon(id: string): string | null {
  return store.get()[id] ?? null;
}

/** Pass `null` to go back to the connector's own icon. */
export function setConnectorIcon(id: string, icon: string | null) {
  store.set(({ [id]: _old, ...rest }) => (icon ? { ...rest, [id]: icon } : rest));
}

const SIZE = 128;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** An image file as a square-fitted 128px PNG `data:` URL (SVGs keep their vector form). */
export async function iconFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file (PNG, JPG, SVG, WebP…)");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("That image is over 5 MB");
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml" && raw.length < 200_000) return raw;
  return shrink(raw);
}

/** A picture from an `https://` link, fetched by the backend. */
export async function iconFromUrl(url: string): Promise<string> {
  const link = url.trim();
  if (!/^https:\/\/\S+$/i.test(link)) throw new Error("Use an https:// link to an image");
  let data: string;
  try {
    data = await invoke<string>("mcp_fetch_icon", { url: link });
  } catch (error) {
    // The backend says why: refused, not an image, too big…
    throw new Error(typeof error === "string" ? error : "Couldn't load an image from that link");
  }
  return data.startsWith("data:image/svg") && data.length < 200_000 ? data : shrink(data);
}

function shrink(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Couldn't process that image"));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("That file isn't an image this app can show"));
    img.src = src;
  });
}
