"use client";

import type { AuthActionBlock, MediaPreviewBlock } from "@/features/chat-blocks";
import { AuthActionList } from "./auth-action-card";
import { MediaPreviewList } from "./media-preview-card";

export function ChatRichBlocks({
  authActions,
  mediaPreviews,
}: {
  authActions: AuthActionBlock[];
  mediaPreviews: MediaPreviewBlock[];
}) {
  if (authActions.length === 0 && mediaPreviews.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <AuthActionList actions={authActions} />
      <MediaPreviewList items={mediaPreviews} />
    </div>
  );
}
