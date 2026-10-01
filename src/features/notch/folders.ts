/**
 * Folders for working from the notch: the ones already allowed in the app
 * (read from storage, newest first), and the one picked last.
 */
import { createStore } from "@/lib/local-store";
import { useSyncExternalStore } from "react";

const GRANTS_KEY = "mali_folder_grants";

export type NotchFolder = { path: string; name: string; access: "read" | "write" };

let raw: string | null | undefined;
let folders: NotchFolder[] = [];

export function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;
}

function read(): NotchFolder[] {
  let next: string | null = null;
  try {
    next = localStorage.getItem(GRANTS_KEY);
  } catch {
    return folders;
  }
  if (next === raw) return folders;
  raw = next;
  try {
    const grants: unknown[] = next ? JSON.parse(next) : [];
    folders = (Array.isArray(grants) ? grants : [])
      .flatMap((g) => {
        const grant = g as { path?: unknown; access?: unknown; grantedAt?: unknown };
        if (typeof grant?.path !== "string") return [];
        return [{ path: grant.path, access: grant.access === "write" ? "write" : "read", at: Number(grant.grantedAt) || 0 }];
      })
      .sort((a, b) => b.at - a.at)
      .map(({ path, access }) => ({ path, name: folderName(path), access: access as NotchFolder["access"] }));
  } catch {
    folders = [];
  }
  return folders;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === GRANTS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** Folders the user allowed in the app, newest first. */
export function useAllowedFolders() {
  return useSyncExternalStore(subscribe, read, () => folders);
}

/** The folder the notch works in; null asks in Chat mode (no files). */
const folderStore = createStore<string | null>(null, { key: "mali.notch.folder" });

export const useNotchFolder = folderStore.use;
export const setNotchFolder = (path: string | null) => folderStore.set(path);
