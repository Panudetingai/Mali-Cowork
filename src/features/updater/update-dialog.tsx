import { CoworkBot } from "@/components/anim/cowork-bot";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { BotState } from "@/features/cowork-bot/store";
import { MALI_EASE } from "@/lib/motion-presets";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { AlertCircle, ArrowRightIcon, DownloadIcon, InfoIcon, Loader2, RotateCcwIcon, Upload } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Let startup settle before going to the network. */
const FIRST_CHECK_MS = 10_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;
/** A version the user chose to skip: not offered again until a newer one comes. */
const SKIPPED_KEY = "mali_update_skipped";

export type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; received: number; total?: number }
  | { kind: "installing" }
  | { kind: "error"; message: string };

async function downloadUpdate(
  update: Update,
  onProgress: (received: number, total?: number) => void,
  onInstalling?: () => void,
) {
  let total: number | undefined;
  let received = 0;
  onProgress(0, total);
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength;
    if (event.event === "Progress") received += event.data.chunkLength;
    if (event.event === "Finished") onInstalling?.();
    else onProgress(received, total);
  });
  await relaunch();
}

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

export type UpdateDialogViewProps = {
  version: string;
  currentVersion: string;
  notes?: string;
  phase: Phase;
  percent?: number;
  onLater: () => void;
  onInstall: () => void;
  /** Don't offer this version again. */
  onSkip?: () => void;
};

/** Pure UI of the update popup: always open, no Tauri calls. Used by dev preview. */
export function UpdateDialogView({ version, currentVersion, notes, phase, percent, onLater, onInstall, onSkip }: UpdateDialogViewProps) {
  const reduced = useReducedMotion();
  const busy = phase.kind === "downloading" || phase.kind === "installing";
  const pose: BotState =
    phase.kind === "downloading" ? "working" : phase.kind === "installing" ? "done" : phase.kind === "error" ? "alert" : "done";
  const ease = { duration: reduced ? 0 : 0.28, ease: MALI_EASE };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onLater()}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        {/* Who's updating, from what to what. */}
        <div className="relative flex items-center gap-4 border-b border-border/60 bg-gradient-to-br from-violet-500/[0.08] via-background to-sky-500/[0.07] px-6 pt-6 pb-5">
          <CoworkBot size={48} state={pose} fps={30} title="Your Cowork bot" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-[17px] leading-tight tracking-tight">
              {phase.kind === "installing" ? "Installing the update…" : phase.kind === "downloading" ? "Updating Mali Cowork…" : "A new version is ready"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-muted-foreground tabular-nums">v{currentVersion}</span>
                <ArrowRightIcon className="size-3 text-muted-foreground" />
                <span className="rounded-md bg-primary px-1.5 py-0.5 font-mono font-semibold text-primary-foreground tabular-nums">
                  v{version}
                </span>
              </div>
            </DialogDescription>
          </div>
        </div>

        <motion.div layout={!reduced} transition={ease} className="flex flex-col gap-4 px-6 py-5">
          {notes?.trim() ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">What's new</h3>
              <div className="relative">
                <div className="max-h-52 overflow-y-auto pr-1 pb-3 text-[13px] [&_.chat-markdown_h1]:text-sm [&_.chat-markdown_h2]:text-sm [&_.chat-markdown_h3]:text-[13px] [&_.chat-markdown]:text-[13px]">
                  <MessageResponse>{notes.trim()}</MessageResponse>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent" />
              </div>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted-foreground">Fixes and improvements to keep Mali running smoothly.</p>
          )}

          <AnimatePresence mode="popLayout" initial={false}>
            {(phase.kind === "downloading" || phase.kind === "installing") && (
              <motion.div
                key="progress"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={ease}
                className="flex flex-col gap-2"
              >
                <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                  {phase.kind === "downloading" && percent != null ? (
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={false}
                      animate={{ width: `${percent}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 24 }}
                    />
                  ) : (
                    // No size known yet, or installing: a bar that keeps moving.
                    <motion.div
                      className="absolute inset-y-0 w-1/3 rounded-full bg-primary"
                      animate={reduced ? undefined : { left: ["-33%", "100%"] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {phase.kind === "installing"
                      ? "Installing — Mali restarts in a moment"
                      : phase.total
                        ? `${megabytes(phase.received)} of ${megabytes(phase.total)}`
                        : "Downloading…"}
                  </span>
                  {phase.kind === "downloading" && percent != null && <span className="font-medium text-foreground">{percent}%</span>}
                </div>
              </motion.div>
            )}
            {phase.kind === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={ease}
                className="flex gap-2.5 rounded-xl p-3 text-xs"
              >
                <AlertCircle className="mt-px size-4 shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">The update didn't finish</p>
                  <p className="mt-0.5 [overflow-wrap:anywhere] text-muted-foreground">{phase.message}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!busy && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <InfoIcon className="mt-px size-3 shrink-0" />
              Mali restarts to finish updating — let any reply that's still running finish first.
            </p>
          )}
        </motion.div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-6 py-3.5">
          {onSkip && !busy ? (
            <button type="button" onClick={onSkip} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              Skip this version
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8" disabled={busy} onClick={onLater}>
              Later
            </Button>
            <Button size="sm" className="h-8 min-w-[9.5rem] gap-1.5" autoFocus disabled={busy} onClick={onInstall}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : phase.kind === "error" ? (
                <RotateCcwIcon className="size-3.5" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              {busy ? (phase.kind === "installing" ? "Installing…" : "Downloading…") : phase.kind === "error" ? "Try again" : "Update & restart"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function readSkipped() {
  try {
    return localStorage.getItem(SKIPPED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks the public releases repo (see `plugins.updater` in tauri.conf.json)
 * and offers a new version. Nothing installs until the user says so: a
 * restart would cut off a reply that is still streaming.
 */
export function UpdateDialog() {
  const [update, setUpdate] = useState<Update>();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // A version put off with "Later" isn't offered again until the next launch.
  const later = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Dev builds aren't signed for the updater and would always look outdated.
    if (import.meta.env.DEV) return;
    let cancelled = false;
    const run = async () => {
      try {
        const found = await check();
        if (!cancelled && found && found.version !== later.current && found.version !== readSkipped()) setUpdate(found);
      } catch (error) {
        // Offline, or no release yet: try again later, quietly.
        console.warn("[updater] check failed", error);
      }
    };
    const first = setTimeout(run, FIRST_CHECK_MS);
    const every = setInterval(run, RECHECK_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  const close = () => {
    setUpdate(undefined);
    setPhase({ kind: "idle" });
  };

  const install = async () => {
    if (!update) return;
    setPhase({ kind: "downloading", received: 0 });
    try {
      await downloadUpdate(
        update,
        (received, total) => setPhase({ kind: "downloading", received, total }),
        () => setPhase({ kind: "installing" }),
      );
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const percent =
    phase.kind === "downloading" && phase.total ? Math.min(100, Math.round((phase.received / phase.total) * 100)) : undefined;

  if (!update) return null;
  return (
    <UpdateDialogView
      version={update.version}
      currentVersion={update.currentVersion}
      notes={update.body ?? undefined}
      phase={phase}
      percent={percent}
      onLater={() => {
        later.current = update.version;
        close();
      }}
      onSkip={() => {
        try {
          localStorage.setItem(SKIPPED_KEY, update.version);
        } catch {
          // Storage unavailable: it's put off for this launch only.
        }
        later.current = update.version;
        close();
      }}
      onInstall={() => void install()}
    />
  );
}

/** Manual update from the title bar: check, download, restart (no dialog). */
export function TitlebarUpdateButton() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  if (import.meta.env.DEV) return null;

  const busy = phase.kind === "checking" || phase.kind === "downloading";
  const percent =
    phase.kind === "downloading" && phase.total
      ? Math.round((phase.received / phase.total) * 100)
      : undefined;

  const run = async () => {
    setPhase({ kind: "checking" });
    try {
      const found = await check();
      if (!found) {
        setPhase({ kind: "idle" });
        toast.info("You're on the latest version");
        return;
      }
      setPhase({ kind: "downloading", received: 0 });
      await downloadUpdate(found, (received, total) => {
        setPhase({ kind: "downloading", received, total });
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Button
      variant={phase.kind === "error" ? "default" : "outline"}
      size="xs"
      className="gap-1.5 rounded-full text-xs"
      onClick={() => void run()}
      disabled={busy}
      title={phase.kind === "error" ? phase.message : undefined}
    >
      {phase.kind === "checking" && (
        <>
          <Loader2 className="size-4 animate-spin" />
          Checking…
        </>
      )}
      {phase.kind === "downloading" && (
        <>
          <Loader2 className="size-4 animate-spin" />
          {percent != null ? `${percent}%` : "Downloading…"}
        </>
      )}
      {phase.kind === "error" && (
        <>
          <AlertCircle className="size-4 text-red-500" />
          Try again
        </>
      )}
      {phase.kind === "idle" && (
        <>
          <Upload className="size-4" />
          Update Now
        </>
      )}
    </Button>
  );
}