import type { PermissionRequest } from "@/pages/chat/api/chat";
import type { PermissionReply } from "@/features/opencode";
import { invoke } from "@tauri-apps/api/core";
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

/** Bring the app forward, for when an answer came from outside the window. */
async function focusWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.unminimize().catch(() => undefined);
    await window.show().catch(() => undefined);
    await window.setFocus();
  } catch {
    // Not in Tauri, or the window is gone; nothing else to do.
  }
}

type NativeAlert = {
  title: string;
  subtitle?: string;
  body: string;
  actions?: string[];
  closeLabel?: string;
  sound?: string;
};

type NativeAlertResult = {
  action: string | null;
  clicked: boolean;
  dismissed: boolean;
  /** This platform has no actionable alert — use the plugin instead. */
  unsupported: boolean;
};

const NOT_SUPPORTED: NativeAlertResult = {
  action: null,
  clicked: false,
  dismissed: false,
  unsupported: true,
};

/**
 * A notification with buttons (macOS). Resolves only once the user answers or
 * it times out, so callers must not await it in a render path.
 */
async function nativeAlert(request: NativeAlert): Promise<NativeAlertResult> {
  try {
    return await invoke<NativeAlertResult>("native_alert", { request });
  } catch {
    return NOT_SUPPORTED;
  }
}

export async function notifyTaskDone(title: string) {
  await notify({ title: "Cowork task done", body: title });
}

/** The three ways to answer an approval, as they read on a notification. */
const REPLY_LABELS: { label: string; reply: PermissionReply }[] = [
  { label: "Allow once", reply: "once" },
  { label: "Always allow", reply: "always" },
];
const DENY_LABEL = "Deny";

/**
 * Tell the user the agent is waiting, and — on macOS — let them answer from
 * the notification itself. The actionable macOS alert is shown even when this
 * window is focused; the plain plugin notification only fires in the
 * background.
 *
 * `onReply` runs when the answer came from the notification; the caller still
 * owns the in-app card, which stays the source of truth.
 */
export async function notifyPermissionPending(
  requests: PermissionRequest[],
  onReply?: (request: PermissionRequest, reply: PermissionReply) => void,
) {
  const request = requests[0];
  if (!request) return;

  const extra = requests.length - 1;
  const body = extra > 0 ? `${request.title} · ${extra} more waiting` : request.title;

  const result = await nativeAlert({
    title: "Cowork needs approval",
    subtitle: request.directory || undefined,
    body,
    actions: REPLY_LABELS.map((r) => r.label),
    closeLabel: DENY_LABEL,
    sound: "Ping",
  });

  if (result.unsupported) {
    await notify({ title: "Cowork needs approval", body });
    return;
  }
  if (result.clicked) {
    await focusWindow();
    return;
  }
  if (result.dismissed) {
    onReply?.(request, "reject");
    return;
  }
  const chosen = REPLY_LABELS.find((r) => r.label === result.action);
  if (chosen) onReply?.(request, chosen.reply);
}

/** The agent asked the user something and can't carry on until it's answered. */
export async function notifyQuestionPending(count: number, firstQuestion?: string) {
  if (!shouldNotify()) return;
  const body =
    count > 1
      ? `${count} questions are waiting for your answer.`
      : firstQuestion || "The agent is waiting for your answer.";

  const result = await nativeAlert({
    title: "Cowork has a question",
    body,
    actions: ["Open Mali Cowork"],
    sound: "Ping",
  });

  if (result.unsupported) {
    await notify({ title: "Cowork has a question", body });
    return;
  }
  if (result.clicked || result.action) await focusWindow();
}
