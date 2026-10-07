import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { AlertCircle, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Let startup settle before going to the network. */
const FIRST_CHECK_MS = 10_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading"; received: number; total?: number }
  | { kind: "error"; message: string };

async function downloadUpdate(
  update: Update,
  onProgress: (received: number, total?: number) => void,
) {
  let total: number | undefined;
  let received = 0;
  onProgress(0, total);
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength;
    if (event.event === "Progress") received += event.data.chunkLength;
    onProgress(received, total);
  });
  await relaunch();
}

/**
 * Checks the public releases repo (see `plugins.updater` in tauri.conf.json)
 * and offers a new version. Nothing installs until the user says so: a
 * restart would cut off a reply that is still streaming.
 */
export function UpdateDialog() {
  const [update, setUpdate] = useState<Update>();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // A version the user put off isn't offered again until the next launch.
  const skipped = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Dev builds aren't signed for the updater and would always look outdated.
    if (import.meta.env.DEV) return;
    let cancelled = false;
    const run = async () => {
      try {
        const found = await check();
        if (!cancelled && found && found.version !== skipped.current) setUpdate(found);
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

  const later = () => {
    skipped.current = update?.version;
    setUpdate(undefined);
    setPhase({ kind: "idle" });
  };

  const install = async () => {
    if (!update) return;
    setPhase({ kind: "downloading", received: 0 });
    try {
      await downloadUpdate(update, (received, total) => {
        setPhase({ kind: "downloading", received, total });
      });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const busy = phase.kind === "downloading";
  const percent =
    phase.kind === "downloading" && phase.total ? Math.round((phase.received / phase.total) * 100) : undefined;

  return (
    <Dialog open={!!update} onOpenChange={(open) => !open && !busy && later()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mali Cowork {update?.version} is available</DialogTitle>
          <DialogDescription>
            You have {update?.currentVersion}. The app restarts to finish updating, so let any running
            reply finish first.
          </DialogDescription>
        </DialogHeader>

        {update?.body?.trim() && (
          <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            {update.body.trim()}
          </div>
        )}

        {phase.kind === "downloading" && (
          <div className="flex flex-col gap-1.5">
            <Progress value={percent ?? 0} />
            <p className="text-xs text-muted-foreground">
              {percent != null ? `Downloading… ${percent}%` : "Downloading…"}
            </p>
          </div>
        )}
        {phase.kind === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">Update failed: {phase.message}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={later}>
            Later
          </Button>
          <Button autoFocus disabled={busy} onClick={install}>
            {phase.kind === "error" ? "Try again" : "Update and restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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