"use client";

import type { RefObject } from "react";
import PromptInput from "./prompt";

type Props = {
  isLoading: boolean;
  promptInputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: (payload: {
    prompt: string;
    modelId: string;
  }) => void | Promise<void>;
};

export function ChatComposer({ isLoading, promptInputRef, onSubmit }: Props) {
  return (
    <div className="w-full max-w-3xl shrink-0">
      <PromptInput
        isLoading={isLoading}
        ref={promptInputRef}
        onSubmit={onSubmit}
      />
    </div>
  );
}
