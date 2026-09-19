import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { ReactNode } from "react";

export type ConfirmRequest = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for actions that lose work. */
  destructive?: boolean;
  onConfirm: () => void;
};

/** Ask before an action that can't be taken back or leaves the machine. */
export function ConfirmDialog({ request, onClose }: { request?: ConfirmRequest; onClose: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{request?.description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={request?.destructive ? "destructive" : "default"}
            autoFocus
            onClick={() => {
              request?.onConfirm();
              onClose();
            }}
          >
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
