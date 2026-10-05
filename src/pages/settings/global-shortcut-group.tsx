"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_QUICK_CONFIG,
  recordShortcut,
  setQuickConfig,
  shortcutKeys,
} from "@/features/quick";
import { cn } from "@/lib/utils";
import { KeyboardIcon, PowerIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Notice, SettingRow, SettingsGroup, StatusPill } from "./ui";
import type { QuickStatus } from "@/features/quick/types";

/** Global shortcut for opening the notch ask box (stored as legacy quick config). */
export function GlobalShortcutGroup({
  mac,
  enabled,
  shortcut,
  status,
}: {
  mac: boolean;
  enabled: boolean;
  shortcut: string;
  status: QuickStatus | undefined;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string>();
  const live = enabled && status?.registered;

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        setHint(undefined);
        return;
      }
      const result = recordShortcut(event, mac);
      if (result.status === "invalid") setHint(result.reason);
      if (result.status === "ok") {
        setRecording(false);
        setHint(undefined);
        void setQuickConfig({ shortcut: result.accelerator, enabled: true });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, mac]);

  return (
    <SettingsGroup title="Shortcut">
      <SettingRow
        icon={<PowerIcon />}
        htmlFor="notch-shortcut-enabled"
        label={
          <span className="flex flex-wrap items-center gap-2">
            Open the notch with a shortcut
            {!enabled ? (
              <StatusPill tone="neutral">Off</StatusPill>
            ) : live ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : status ? (
              <StatusPill tone="danger">Not working</StatusPill>
            ) : (
              <StatusPill tone="pending">Starting…</StatusPill>
            )}
          </span>
        }
        description="Works from any app, even when Mali is in the background. Opens the ask box at the top of the screen."
        control={
          <Switch
            id="notch-shortcut-enabled"
            checked={enabled}
            onCheckedChange={(on) => void setQuickConfig({ enabled: on })}
          />
        }
      >
        {enabled && status && !status.registered && status.error && (
          <Notice tone="danger" title="The shortcut isn't active">
            {status.error}. Try a different combination.
          </Notice>
        )}
      </SettingRow>
      <SettingRow
        icon={<KeyboardIcon />}
        label="Keyboard shortcut"
        description={
          recording ? (
            <span className={cn(hint && "text-red-600 dark:text-red-400")}>
              {hint ?? "Press the new key combination… (Esc to cancel)"}
            </span>
          ) : (
            "Click Change, then press the keys you want."
          )
        }
        className={cn(!enabled && "opacity-60")}
        control={
          <>
            {recording ? (
              <span className="flex h-8 items-center rounded-md border border-dashed border-primary/60 px-3 text-xs text-primary">
                Recording…
              </span>
            ) : (
              <span className="flex items-center gap-1" aria-label={`Shortcut ${shortcut}`}>
                {shortcutKeys(shortcut, mac).map((key, i) => (
                  <Keycap key={`${key}-${i}`}>{key}</Keycap>
                ))}
              </span>
            )}
            <Button
              variant={recording ? "secondary" : "outline"}
              size="sm"
              disabled={!enabled}
              onClick={() => {
                setHint(undefined);
                setRecording((r) => !r);
              }}
            >
              {recording ? "Cancel" : "Change"}
            </Button>
            {shortcut !== DEFAULT_QUICK_CONFIG.shortcut && !recording && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Reset to ${shortcutKeys(DEFAULT_QUICK_CONFIG.shortcut, mac).join(mac ? "" : "+")}`}
                aria-label="Reset shortcut"
                onClick={() => void setQuickConfig({ shortcut: DEFAULT_QUICK_CONFIG.shortcut, enabled: true })}
              >
                <RotateCcwIcon />
              </Button>
            )}
          </>
        }
      />
    </SettingsGroup>
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border/80 border-b-2 bg-background px-1.5 font-sans text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}
