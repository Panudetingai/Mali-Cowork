import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { createStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import { EyeIcon, FolderLockIcon, PencilLineIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
    findGrant,
    folderName,
    grantFolder,
    normalizeFolder,
    type FolderAccess,
    type FolderGrant,
} from "./folder-access";

type Options = {
  /** Why the folder is needed, shown in the dialog. */
  reason?: string;
  /** Offer parent folders too, so one answer covers sibling folders. */
  allowWider?: boolean;
};

type Pending = Options & {
  path: string;
  waiters: ((grant: FolderGrant | null) => void)[];
};

// One dialog at a time; later requests wait their turn instead of cancelling
// earlier ones, and repeated requests for the same folder share one answer.
const queueStore = createStore<Pending[]>([]);

/**
 * Ask the user whether the agent may use `path`. Resolves with the grant
 * (which may cover a parent folder), or null when declined.
 */
export function requestFolderAccess(path: string, options: Options = {}): Promise<FolderGrant | null> {
  const folder = normalizeFolder(path);
  const existing = findGrant(folder);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    queueStore.set((queue) => {
      const same = queue.find((p) => p.path === folder);
      if (same) {
        same.waiters.push(resolve);
        return [...queue];
      }
      return [...queue, { ...options, path: folder, waiters: [resolve] }];
    });
  });
}

function settle(request: Pending, grant: FolderGrant | null) {
  queueStore.set((queue) => queue.filter((p) => p !== request));
  // Queued requests the new grant already covers resolve too.
  const covered = grant
    ? queueStore.get().filter((p) => findGrant(p.path))
    : [];
  if (covered.length) queueStore.set((queue) => queue.filter((p) => !covered.includes(p)));
  request.waiters.forEach((resolve) => resolve(grant));
  covered.forEach((p) => p.waiters.forEach((resolve) => resolve(findGrant(p.path) ?? null)));
}

/** The folder and up to three parents, stopping above the home level. */
export function scopeChoices(path: string): string[] {
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(/[\\/]/);
  const choices: string[] = [];
  // Never offer home or above: keep /Users/me/x or C:\Users\me\x at least.
  for (let n = parts.length; n >= 4 && choices.length < 4; n--) {
    choices.push(parts.slice(0, n).join(sep));
  }
  return choices.length ? choices : [path];
}

const OPTIONS: { access: FolderAccess; label: string; hint: string; icon: typeof EyeIcon }[] = [
  {
    access: "read",
    label: "Read only",
    hint: "Look at files; changes are blocked",
    icon: EyeIcon,
  },
  {
    access: "write",
    label: "Read & write",
    hint: "Create, edit and run commands",
    icon: PencilLineIcon,
  },
];

/** Mounted once; shows the oldest pending folder request. */
export function FolderAccessDialog() {
  const request = queueStore.use()[0];
  const [access, setAccess] = useState<FolderAccess>("write");
  const [scope, setScope] = useState("");
  const choices = request?.allowWider ? scopeChoices(request.path) : request ? [request.path] : [];

  useEffect(() => {
    setAccess("write");
    setScope(request?.path ?? "");
  }, [request]);

  const allow = () => {
    if (!request) return;
    const path = scope || request.path;
    grantFolder(path, access);
    settle(request, findGrant(path) ?? { path, access, grantedAt: Date.now() });
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && request && settle(request, null)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        {request && (
          <>
            <DialogHeader>
              <span className="mb-1 flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary">
                <FolderLockIcon className="size-4" />
              </span>
              <DialogTitle>Allow access to “{folderName(scope || request.path)}”?</DialogTitle>
              <DialogDescription>
                {request.reason ?? "Cowork needs your permission before it works in this folder."} You can
                change or revoke it any time in Settings → Folders.
              </DialogDescription>
            </DialogHeader>

            {choices.length > 1 ? (
              <div role="radiogroup" aria-label="Folder to allow" className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">Folder</p>
                {choices.map((choice, index) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={scope === choice}
                    onClick={() => setScope(choice)}
                    title={choice}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted/50",
                      scope === choice && "border-primary bg-muted/60",
                    )}
                  >
                    <span className="truncate">{choice}</span>
                    <span className="shrink-0 font-sans text-[10px] text-muted-foreground">
                      {index === 0 ? "requested" : "includes subfolders"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p
                className="truncate rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs"
                title={request.path}
              >
                {request.path}
              </p>
            )}

            <div role="radiogroup" aria-label="Access level" className="grid grid-cols-2 gap-2">
              {OPTIONS.map(({ access: value, label, hint, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={access === value}
                  onClick={() => setAccess(value)}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50",
                    access === value && "border-primary bg-muted/60 ring-1 ring-primary",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="size-4 text-muted-foreground" />
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => settle(request, null)}>
                Don’t allow
              </Button>
              <Button type="button" onClick={allow} autoFocus>
                Allow
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
