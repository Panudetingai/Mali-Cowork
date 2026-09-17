import { createStore } from "@/lib/local-store";

export type FolderAccess = "read" | "write";

export type FolderGrant = {
  path: string;
  access: FolderAccess;
  grantedAt: number;
};

// Folders the user explicitly allowed the agent to use.
const grantStore = createStore<FolderGrant[]>([], {
  key: "mali_folder_grants",
  revive: (grants) => (Array.isArray(grants) ? grants : []),
});

export const useFolderGrants = grantStore.use;

export function normalizeFolder(path: string) {
  const trimmed = path.trim();
  // Keep a bare root ("/" or "C:\") intact.
  return trimmed.length > 1 ? trimmed.replace(/[\\/]+$/, "") || trimmed : trimmed;
}

/** True when `path` is `folder` or lies inside it. */
export function isWithin(path: string, folder: string) {
  const p = normalizeFolder(path);
  const f = normalizeFolder(folder);
  if (p === f) return true;
  const sep = f.endsWith("/") || f.endsWith("\\") ? "" : f.includes("\\") ? "\\" : "/";
  return p.startsWith(f + sep);
}

/** The grant that covers `path`, preferring the most specific folder. */
export function findGrant(path: string, grants = grantStore.get()): FolderGrant | undefined {
  return grants
    .filter((g) => isWithin(path, g.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

export function grantFolder(path: string, access: FolderAccess) {
  const folder = normalizeFolder(path);
  if (!folder) return;
  grantStore.set((prev) => [
    { path: folder, access, grantedAt: Date.now() },
    ...prev.filter((g) => g.path !== folder),
  ]);
}

export function revokeFolder(path: string) {
  const folder = normalizeFolder(path);
  grantStore.set((prev) => prev.filter((g) => g.path !== folder));
}

export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path || "Default";
}

/**
 * Grants that matter for a set of folders: each folder with its effective
 * access, plus granted folders nested inside or containing them, so a
 * read-only subfolder stays protected.
 */
export function grantsFor(folders: string[], grants = grantStore.get()): { path: string; access: FolderAccess }[] {
  const result = new Map<string, FolderAccess>();
  for (const folder of folders) {
    const grant = findGrant(folder, grants);
    if (grant) result.set(normalizeFolder(folder), grant.access);
  }
  for (const grant of grants) {
    if (folders.some((f) => isWithin(grant.path, f) || isWithin(f, grant.path))) {
      if (!result.has(grant.path)) result.set(grant.path, grant.access);
    }
  }
  return [...result].map(([path, access]) => ({ path, access }));
}
