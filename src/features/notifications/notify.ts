import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  type Options,
} from "@tauri-apps/plugin-notification";

let permissionRequested = false;

async function ensurePermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  if (permissionRequested) return false;
  permissionRequested = true;
  const permission = await requestPermission();
  return permission === "granted";
}

/** Only notify when the window is not active, so we don't interrupt the user. */
function shouldNotify() {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || !document.hasFocus();
}

export async function notify(options: Options) {
  if (!shouldNotify()) return;
  if (!(await ensurePermission())) return;
  sendNotification(options);
}

export async function notifyTaskDone(title: string) {
  await notify({ title: "Cowork task done", body: title });
}

export async function notifyPermissionPending(count: number) {
  await notify({
    title: "Cowork needs approval",
    body: count === 1 ? "A command is waiting for your permission." : `${count} actions are waiting for your permission.`,
  });
}
