/**
 * Dev only (/dev/update): show the real update popup UI without Tauri updater.
 * Uses UpdateDialogView (the same UI UpdateDialog renders in production).
 */
import { UpdateDialogView } from "@/features/updater/update-dialog";
import { SectionHeader, SettingsSection } from "@/pages/settings/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const NOTES = `## What's new in 0.3.0

- Faster chat replies
- Thai invoice template fixes
- Notch mode stability improvements

Full changelog: https://github.com/anomalyco/opencode/releases`;

type Case = "available" | "downloading" | "downloading-unknown" | "installing" | "error" | "no-notes";

const CASES: { id: Case; label: string }[] = [
  { id: "available", label: "Available" },
  { id: "downloading", label: "Downloading 45%" },
  { id: "downloading-unknown", label: "Downloading…" },
  { id: "installing", label: "Installing" },
  { id: "error", label: "Error" },
  { id: "no-notes", label: "No notes" },
];

export default function UpdatePreviewPage() {
  const [active, setActive] = useState<Case>("available");
  const [open, setOpen] = useState(true);

  const pick = (id: Case) => {
    setActive(id);
    setOpen(true);
  };
  const handleLater = () => setOpen(false);
  // Simulate install flow in preview: Available -> Downloading, Error -> retry.
  const handleInstall = () => {
    if (active === "available" || active === "no-notes" || active === "error") {
      setActive("downloading");
      setOpen(true);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Update popup (preview)"
        description={
          <>
            The real <code className="rounded bg-muted px-1 font-mono text-[11px]">UpdateDialogView</code> production uses,
            without calling the Tauri updater.
          </>
        }
        actions={
          <Link
            to="/"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Back to chat
          </Link>
        }
      />

      <SettingsSection className="mt-8">
        <h3 className="text-sm font-medium text-foreground">State</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {CASES.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-sm",
                c.id === active && "bg-foreground text-background",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </SettingsSection>

      {/* Render the real dialog UI for the selected state. Closed -> show reopen. */}
      <div className="mt-6">
        {!open ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-sm">
            <span className="text-muted-foreground">Closed (Later, Skip, or a click outside).</span>
            <button
              onClick={() => setOpen(true)}
              className="rounded-md border px-2 py-1 font-medium hover:bg-muted"
            >
              Show again
            </button>
          </div>
        ) : (
          <>
            {active === "available" && (
              <UpdateDialogView
                version="0.3.0"
                currentVersion="0.2.2"
                notes={NOTES}
                phase={{ kind: "idle" }}
                onLater={handleLater}
                onSkip={handleLater}
                onInstall={handleInstall}
              />
            )}
            {active === "downloading" && (
              <UpdateDialogView
                version="0.3.0"
                currentVersion="0.2.2"
                notes={NOTES}
                phase={{ kind: "downloading", received: 17_150_000, total: 38_100_000 }}
                percent={45}
                onLater={handleLater}
                onInstall={handleInstall}
              />
            )}
            {active === "downloading-unknown" && (
              <UpdateDialogView
                version="0.3.0"
                currentVersion="0.2.2"
                notes={NOTES}
                phase={{ kind: "downloading", received: 0 }}
                percent={undefined}
                onLater={handleLater}
                onInstall={handleInstall}
              />
            )}
            {active === "installing" && (
              <UpdateDialogView
                version="0.3.0"
                currentVersion="0.2.2"
                notes={NOTES}
                phase={{ kind: "installing" }}
                onLater={handleLater}
                onInstall={handleInstall}
              />
            )}
            {active === "error" && (
              <UpdateDialogView
                version="0.3.0"
                currentVersion="0.2.2"
                notes={NOTES}
                phase={{ kind: "error", message: "network timeout, please retry" }}
                onLater={handleLater}
                onInstall={handleInstall}
              />
            )}
            {active === "no-notes" && (
              <UpdateDialogView
                version="0.3.0"
                currentVersion="0.2.2"
                phase={{ kind: "idle" }}
                onLater={handleLater}
                onSkip={handleLater}
                onInstall={handleInstall}
              />
            )}
          </>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        The real <code className="font-mono">UpdateDialog</code> never opens in dev (it's guarded by{" "}
        <code className="font-mono">import.meta.env.DEV</code>: dev builds aren't signed for the updater), so this page renders{" "}
        <code className="font-mono">UpdateDialogView</code> directly.
      </p>
    </div>
  );
}
