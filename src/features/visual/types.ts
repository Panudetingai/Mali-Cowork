import type { MediaKind } from "@/features/media";

export type { MediaKind };

/** A size the picture controls offer, and what it means to a provider. */
export type SizePreset = {
  id: string;
  /** What the button says: pixels, or "Auto". */
  label: string;
  /** Sent as `aspect_ratio`; undefined lets the model choose. */
  ratio?: string;
  /** Proportions of the little preview square on the button. */
  shape: { w: number; h: number };
};

/**
 * Providers disagree on exact pixel sizes and most only take a ratio, so the
 * buttons are labelled by shape rather than by a resolution one provider
 * happens to accept and another rejects.
 */
export const SIZES: SizePreset[] = [
  { id: "auto", label: "Auto", shape: { w: 18, h: 14 } },
  { id: "16:9", label: "16:9", ratio: "16:9", shape: { w: 20, h: 11 } },
  { id: "4:3", label: "4:3", ratio: "4:3", shape: { w: 18, h: 13 } },
  { id: "1:1", label: "1:1", ratio: "1:1", shape: { w: 15, h: 15 } },
  { id: "3:4", label: "3:4", ratio: "3:4", shape: { w: 13, h: 18 } },
  { id: "9:16", label: "9:16", ratio: "9:16", shape: { w: 11, h: 20 } },
];

export const RESOLUTIONS = ["1080P", "720P", "480P"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Stops on the duration slider, in seconds. */
export const DURATIONS = [2, 5, 10, 20, 30] as const;

/** Most pictures one request may ask for; matches `MAX_COUNT` in Rust. */
export const MAX_COUNT = 4;

export type ImageSettings = {
  /** Model id, `api:provider/model`. */
  modelId?: string;
  sizeId: string;
  count: number;
};

export type VideoSettings = {
  modelId?: string;
  sizeId: string;
  resolution: Resolution;
  /** `smart` lets the model choose; `custom` sends `seconds`. */
  durationMode: "smart" | "custom";
  seconds: number;
};

/** One finished picture or clip, kept so the page still shows it next time. */
export type VisualItem = {
  id: string;
  kind: MediaKind;
  /** Absolute path on this computer. */
  path: string;
  prompt: string;
  modelId: string;
  createdAt: number;
};
