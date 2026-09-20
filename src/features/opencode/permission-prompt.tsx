import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PermissionRequest } from "@/pages/chat/api/chat";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { PermissionReply } from "./types";
import { CoworkBot } from "@/components/anim/cowork-bot";

type Props = {
  requests: PermissionRequest[];
  onReply: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  /** Grant a whole folder the agent asked to reach. */
  onAllowFolder?: (request: PermissionRequest, folder: string) => Promise<void>;
  /** Sits under the composer with only the top edge peeking out. */
  stacked?: boolean;
  className?: string;
};

/** The folder behind an `external_directory` request, e.g. `/a/b/*` → `/a/b`. */
export function requestedFolder(request: PermissionRequest) {
  if (request.permission !== "external_directory") return undefined;
  const pattern = request.patterns[0];
  return pattern?.replace(/\*+$/, "").replace(/[\\/]+$/, "") || undefined;
}

/** Splits "Run command: git status" into an action label and its target. */
function splitTitle(title: string) {
  const match = /^([^:]{1,32}):\s*(.+)$/s.exec(title);
  return match ? { action: match[1], target: match[2] } : { action: title, target: undefined };
}

/** Approval card shown while the agent waits for the user. */
export function PermissionPrompt({ requests, onReply, onAllowFolder, stacked, className }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const request = requests[0];

  useEffect(() => setExpanded(false), [request?.id]);

  const reply = async (value: PermissionReply) => {
    if (!request) return;
    setBusyId(request.id);
    try {
      await onReply(request, value);
    } finally {
      setBusyId(null);
    }
  };
  const busy = request != null && busyId === request.id;
  const folder = request ? requestedFolder(request) : undefined;
  const { action, target } = splitTitle(request?.title ?? "");

  const allowFolder = async (path: string) => {
    if (!request) return;
    setBusyId(request.id);
    try {
      await onAllowFolder?.(request, path);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AnimatePresence initial={false}>
      {request ? (
        <motion.div
          key={request.id}
          role="alertdialog"
          aria-label="Permission required"
          initial={{ opacity: 0, y: stacked ? 21 : 16, scale: stacked ? 0.97 : 1 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: stacked ? 24 : 8, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.85 }}
          className={cn(
            "w-full overflow-hidden border",
            stacked ? "rounded-t-xl" : "rounded-t-xl",
            className,
          )}
        >
          <div className={cn("px-3 pt-2.5", stacked ? "pb-3.5" : "pb-2.5")}>
            <div className="flex items-center gap-2.5">
              <CoworkBot 
                bot="mochi"
                state="idle"
                size={46}
              />
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
                <span className="shrink-0 font-medium text-foreground">{action}</span>
                {target && (
                  <code
                    title={target}
                    className="min-w-0 truncate rounded bg-background/70 px-1.5 py-0.5 font-mono text-xs text-foreground/80"
                  >
                    {target}
                  </code>
                )}
              </div>
              {requests.length > 1 && (
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  1/{requests.length}
                </span>
              )}
            </div>

            <AnimatePresence initial={false}>
              {expanded && request.detail && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg border-border/60 bg-background/90 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground/85">
                    {request.detail}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-2 flex items-center gap-1.5">
              {request.detail ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                >
                  {expanded ? "Hide details" : "Show details"}
                </Button>
              ) : folder ? (
                <span className="truncate text-xs text-muted-foreground">Folder not allowed yet</span>
              ) : null}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
                    Allow folder
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => reply("always")}
                  >
                    Always
                  </Button>
                )}
                <Button type="button" size="sm" disabled={busy} onClick={() => reply("once")} autoFocus>
                  Allow once
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
