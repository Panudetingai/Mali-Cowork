import { message } from "@tauri-apps/plugin-dialog";
import { findGrant, folderName, grantFolder, normalizeFolder, type FolderGrant } from "./folder-access";

type Options = {
  /** Why the folder is needed, shown in the dialog. */
  reason?: string;
};

const READ_WRITE = "Read & write";
const READ_ONLY = "Read only";
const DENY = "Don’t allow";

// One system dialog at a time, and repeated requests for the same folder
// share one answer.
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<FolderGrant | null>>();

/**
 * Ask the user, with the system's own dialog, whether the agent may use
 * `path`. Resolves with the grant, or null when declined.
 */
export function requestFolderAccess(path: string, options: Options = {}): Promise<FolderGrant | null> {
  const folder = normalizeFolder(path);
  const existing = findGrant(folder);
  if (existing) return Promise.resolve(existing);

  const same = pending.get(folder);
  if (same) return same;

  const request = queue.then(() => ask(folder, options));
  queue = request.catch(() => undefined);
  pending.set(folder, request);
  void request.finally(() => pending.delete(folder));
  return request;
}

async function ask(folder: string, { reason }: Options): Promise<FolderGrant | null> {
  // An earlier answer may already cover this folder.
  const covered = findGrant(folder);
  if (covered) return covered;

  const answer = await message(
    [
      folder,
      reason ?? "Cowork needs your permission before it works in this folder.",
      `${READ_ONLY}: look at files, changes are blocked.\n${READ_WRITE}: create, edit and run commands.`,
      "You can change or revoke this in Settings → Folders.",
    ].join("\n\n"),
    {
      title: `Allow Mali Cowork to use “${folderName(folder)}”?`,
      kind: "info",
      buttons: { yes: READ_WRITE, no: READ_ONLY, cancel: DENY },
    },
  );

  const access = answer === READ_WRITE ? "write" : answer === READ_ONLY ? "read" : null;
  if (!access) return null;
  grantFolder(folder, access);
  return findGrant(folder) ?? { path: folder, access, grantedAt: Date.now() };
}
