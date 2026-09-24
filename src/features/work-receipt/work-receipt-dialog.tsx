"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChatSession } from "@/features/chat-history";
import type { WorkReceipt } from "./types";
import { WorkReceiptCard } from "./work-receipt-card";

type Props = {
  receipt: WorkReceipt;
  session: Pick<ChatSession, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The receipt opens on demand from the reply's action bar, so the chat —
 * where the user works — shows only the reply and its Files changed.
 */
export function WorkReceiptDialog({ receipt, session, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The card has its own header with Export/Undo; a close button would sit on top of them. */}
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Work receipt</DialogTitle>
        <WorkReceiptCard
          receipt={receipt}
          session={session}
          className="mt-0 rounded-none border-0 bg-transparent"
        />
      </DialogContent>
    </Dialog>
  );
}
