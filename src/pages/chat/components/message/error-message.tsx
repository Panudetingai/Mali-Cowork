"use client";

import { Message, MessageActions, MessageAction, MessageContent } from "@/components/ai-elements/message";
import { AutolinkText } from "@/components/autolink-text";
import { Button } from "@/components/ui/button";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { requestCursorLogin } from "@/features/cursor";
import { getOpencodeModels, requestProviderKey } from "@/features/opencode";
import { getProvider } from "@/features/providers";
import type { ErrorFix } from "@/pages/chat/types";
import { KeyRoundIcon, RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ExpandableClamp } from "./expandable-clamp";

type Props = {
  content: string;
  /** Resend the prompt that failed. Undefined hides the button. */
  onRetry?: () => void;
  /** What the user can do about this error, offered as a button. */
  fix?: ErrorFix;
};

export function ErrorMessage({ content, onRetry, fix }: Props) {
  return (
    <Message from="assistant" className="py-3">
      <MessageContent className="w-full max-w-none rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
        <div className="flex items-start gap-3">
          <CoworkBot state="alert" size={36} className="-my-1 -ml-1" title="Something went wrong" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <ExpandableClamp maxHeightClass="max-h-40">
              <AutolinkText text={content} className="whitespace-pre-wrap" />
            </ExpandableClamp>
            {fix && <FixButton fix={fix} onFixed={onRetry} />}
          </div>
        </div>
      </MessageContent>
      {onRetry && (
        <MessageActions className="mt-2">
          <MessageAction tooltip="Retry" onClick={onRetry}>
            <RotateCcwIcon className="size-3.5" />
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
}

/** Opens the dialog that fixes the error, and resends the prompt once it is done. */
function FixButton({ fix, onFixed }: { fix: ErrorFix; onFixed?: () => void }) {
  if (fix.kind === "cursor-login") {
    return (
      <Action onClick={() => requestCursorLogin({ onSignedIn: onFixed })}>Sign in to Cursor</Action>
    );
  }
  const name =
    getProvider(fix.providerId)?.name ??
    getOpencodeModels()?.providers.find((p) => p.id === fix.providerId)?.name ??
    fix.providerId;
  return (
    <Action
      onClick={() =>
        requestProviderKey({
          providerId: fix.providerId,
          target: fix.target,
          modelName: fix.modelName,
          invalid: fix.invalid,
          onSaved: onFixed,
        })
      }
    >
      <KeyRoundIcon className="size-3.5" />
      {fix.invalid ? `Update ${name} API key` : `Add ${name} API key`}
    </Action>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      className="w-fit gap-1.5 border-red-300 bg-white/70 text-red-700 hover:bg-white dark:border-red-800 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/40"
    >
      {children}
    </Button>
  );
}
