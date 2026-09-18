import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PermissionRequest } from "@/pages/chat/api/chat";
import { ShieldAlertIcon } from "lucide-react";
import { useState } from "react";
import type { PermissionReply } from "./types";

type Props = {
  requests: PermissionRequest[];
  onReply: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  /** Grant a whole folder the agent asked to reach. */
  onAllowFolder?: (request: PermissionRequest, folder: string) => Promise<void>;
};

/** The folder behind an `external_directory` request, e.g. `/a/b/*` → `/a/b`. */
export function requestedFolder(request: PermissionRequest) {
  if (request.permission !== "external_directory") return undefined;
  const pattern = request.patterns[0];
  return pattern?.replace(/\*+$/, "").replace(/[\\/]+$/, "") || undefined;
}

/** Approval card shown above the composer while the agent waits for the user. */
export function PermissionPrompt({ requests, onReply, onAllowFolder }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const request = requests[0];
  if (!request) return null;

  const reply = async (value: PermissionReply) => {
    setBusyId(request.id);
    try {
      await onReply(request, value);
    } finally {
      setBusyId(null);
    }
  };
  const busy = busyId === request.id;
  const folder = requestedFolder(request);

  const allowFolder = async (path: string) => {
    setBusyId(request.id);
    try {
      await onAllowFolder?.(request, path);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-label="Permission required"
      className="mx-auto mb-2 w-full max-w-3xl rounded-xl border border-amber-300 bg-amber-50/80 p-3 shadow-sm dark:border-amber-800 dark:bg-amber-950/30"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <ShieldAlertIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{request.title}</p>
            {requests.length > 1 && (
              <span className="shrink-0 text-xs text-muted-foreground">
                1 of {requests.length}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {folder
              ? "OpenCode wants to use a folder you haven’t allowed yet."
              : "OpenCode wants permission to continue."}
          </p>
          {request.detail && (
            <pre
              className={cn(
                "mt-2 max-h-40 overflow-auto rounded-md border bg-background/80 px-2.5 py-2",
                "font-mono text-xs whitespace-pre-wrap break-all",
              )}
            >
              {request.detail}
            </pre>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => reply("reject")}
        >
          Deny
        </Button>
        {folder && onAllowFolder ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => allowFolder(folder)}
          >
            Allow folder…
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => reply("always")}
          >
            Always allow
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => reply("once")}
          autoFocus
        >
          Allow once
        </Button>
      </div>
    </div>
  );
}
