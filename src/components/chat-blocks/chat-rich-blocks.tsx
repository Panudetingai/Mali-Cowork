"use client";

import type { AuthActionBlock, GalleryBlock, MediaPreviewBlock } from "@/features/chat-blocks";
import { AuthActionList } from "./auth-action-card";
import { GalleryCard } from "./gallery-card";
import { MediaPreviewList } from "./media-preview-card";

export function ChatRichBlocks({
  authActions,
  mediaPreviews,
  galleries = [],
}: {
  authActions: AuthActionBlock[];
  mediaPreviews: MediaPreviewBlock[];
  galleries?: GalleryBlock[];
}) {
  if (authActions.length === 0 && mediaPreviews.length === 0 && galleries.length === 0) return null;
  return (
    <div className="mt-3 flex w-full min-w-0 flex-col gap-3">
      {galleries.map((gallery, i) => (
        <GalleryCard key={`${gallery.url ?? ""}-${i}`} gallery={gallery} />
      ))}
      <AuthActionList actions={authActions} />
      <MediaPreviewList items={mediaPreviews} />
    </div>
  );
}
