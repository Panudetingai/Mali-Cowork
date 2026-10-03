import { isTauri } from "@tauri-apps/api/core";
import { sendNotchSetup, showNotch } from "@/features/notch/bridge";
import type { NotchSetup } from "@/features/notch/types";

function push(setup: NotchSetup) {
  if (!isTauri()) return;
  if (setup.active) void showNotch(false).catch(() => undefined);
  void sendNotchSetup(setup).catch(() => undefined);
}

export function notifyNotchSetupScan(detail?: string) {
  push({
    active: true,
    phase: "scan",
    title: "Checking your Mac…",
    detail: detail ?? "Mali is getting ready before you chat.",
  });
}

export function notifyNotchSetupInstall(title: string, detail?: string, progress?: number) {
  push({
    active: true,
    phase: "install",
    title,
    detail,
    progress,
  });
}

export function notifyNotchSetupDone(title = "Setup complete") {
  push({ active: true, phase: "done", title, detail: "You're ready to chat." });
  setTimeout(() => clearNotchSetup(), 4000);
}

export function clearNotchSetup() {
  push({ active: false, phase: "done", title: "" });
}
