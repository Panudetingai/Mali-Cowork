import { createStore } from "@/lib/local-store";
import type { ImageSettings, VideoSettings, VisualItem } from "./types";

const DEFAULT_IMAGE: ImageSettings = { sizeId: "auto", count: 1 };
const DEFAULT_VIDEO: VideoSettings = {
  sizeId: "auto",
  resolution: "1080P",
  durationMode: "smart",
  seconds: 5,
};

const imageStore = createStore<ImageSettings>(DEFAULT_IMAGE, { key: "visual_image_settings" });
const videoStore = createStore<VideoSettings>(DEFAULT_VIDEO, { key: "visual_video_settings" });

export const useImageSettings = imageStore.use;
export const useVideoSettings = videoStore.use;
export const getImageSettings = imageStore.get;
export const getVideoSettings = videoStore.get;

export function patchImageSettings(patch: Partial<ImageSettings>) {
  imageStore.set((prev) => ({ ...prev, ...patch }));
}

export function patchVideoSettings(patch: Partial<VideoSettings>) {
  videoStore.set((prev) => ({ ...prev, ...patch }));
}

/**
 * What has been made, newest first. Paths only — the files live in the app's
 * media folder and are read on demand, so a long history costs nothing until
 * it is scrolled to.
 */
const MAX_HISTORY = 200;
const itemsStore = createStore<VisualItem[]>([], { key: "visual_items" });

export const useVisualItems = itemsStore.use;

export function addVisualItems(items: VisualItem[]) {
  if (items.length === 0) return;
  itemsStore.set((prev) => [...items, ...prev].slice(0, MAX_HISTORY));
}

export function removeVisualItem(id: string) {
  itemsStore.set((prev) => prev.filter((item) => item.id !== id));
}

export function clearVisualItems() {
  itemsStore.set([]);
}
