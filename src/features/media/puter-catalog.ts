/**
 * Puter's models. They run in the backend on the Puter token from Settings →
 * Models (credits from the user's own Puter account, free plan included);
 * see src-tauri/src/puter.rs.
 *
 * Which models exist comes from Puter's own lists, fetched by the backend
 * (`puter_models`) and kept here, so a model Puter adds shows up and one it
 * retires goes away without a release. The few below are only for a first
 * start with no network.
 */
import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";
import type { MediaKind } from "./api";

export type PuterKind = "chat" | MediaKind;

/** A Puter model as the backend reports it. */
export type PuterModel = {
  id: string;
  name: string;
  /** Chat: it can call tools (Cowork needs that). */
  toolCall?: boolean;
  /** Chat: it can see pictures. */
  vision?: boolean;
  context?: number;
  /** Pictures and clips: it can start from a picture. */
  imageInput?: boolean;
  /** Clips: the lengths it makes, in seconds. */
  durations?: number[];
  releaseDate?: string;
};

const FALLBACK: Record<MediaKind, PuterModel[]> = {
  image: [
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image" },
    { id: "@cf/black-forest-labs/flux-1-schnell", name: "FLUX.1 Schnell" },
    { id: "grok-imagine-image", name: "Grok Imagine" },
  ],
  video: [
    { id: "veo-3.1-lite-generate-preview", name: "Veo 3.1 Lite" },
    { id: "veo-3.1-fast-generate-preview", name: "Veo 3.1 Fast" },
    { id: "veo-3.1-generate-preview", name: "Veo 3.1" },
  ],
};

const store = createStore<Record<PuterKind, PuterModel[]>>(
  { chat: [], image: [], video: [] },
  {
    key: "mali_puter_models",
    // Pictures and clips are kept for an offline start; the chat list
    // (a thousand models) is fetched when Settings asks for it.
    persist: (lists) => ({ ...lists, chat: [] }),
  },
);

export const usePuterModels = store.use;

/** The models Puter offers for `kind`, as last fetched (or the fallback). */
export function puterModels(kind: PuterKind): PuterModel[] {
  const fetched = store.get()[kind];
  if (fetched.length) return fetched;
  return kind === "chat" ? [] : FALLBACK[kind];
}

const pending = new Map<PuterKind, Promise<PuterModel[]>>();

/** Ask Puter for its current list (the backend keeps it for an hour). */
export function refreshPuterModels(kind: PuterKind, baseUrl?: string | null): Promise<PuterModel[]> {
  let request = pending.get(kind);
  if (!request) {
    request = invoke<PuterModel[]>("puter_models", { kind, baseUrl: baseUrl ?? null })
      .then((list) => {
        store.set((lists) => ({ ...lists, [kind]: list }));
        return list;
      })
      .finally(() => pending.delete(kind));
    pending.set(kind, request);
  }
  return request;
}
