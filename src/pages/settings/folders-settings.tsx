import { Button } from "@/components/ui/button";
import {
  FolderAccessDialog,
  folderName,
  grantFolder,
  requestFolderAccess,
  revokeFolder,
  useFolderGrants,
  type FolderAccess,
} from "@/features/workspace";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderIcon, FolderPlusIcon, Trash2Icon } from "lucide-react";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function FoldersSettings() {
  const grants = useFolderGrants();

  const addFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Allow a folder" });
    if (typeof folder === "string" && folder) await requestFolderAccess(folder);
  };

  return (
    <section className="rounded-3xl bg-muted/60 p-5">
      <div className="flex items-start justify-between gap-3 pb-3">
        <div>
          <h2 className="text-base font-semibold">Folder access</h2>
          <p className="text-sm text-muted-foreground">
            Cowork only works in folders you allow here. Chat never reads your files.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addFolder} className="shrink-0 gap-1.5">
          <FolderPlusIcon className="size-4" />
          Allow folder
        </Button>
      </div>
      <div className="mb-4 h-px bg-border" />

      {grants.length === 0 ? (
        <p className="rounded-2xl bg-background p-5 text-sm text-muted-foreground shadow-xs">
          No folders allowed yet. You’ll be asked the first time Cowork needs one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.map((grant) => (
            <li
              key={grant.path}
              className="flex items-center gap-3 rounded-2xl bg-background p-3 shadow-xs"
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{folderName(grant.path)}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={grant.path}>
                  {grant.path}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Allowed {dateFormat.format(grant.grantedAt)}
                </p>
              </div>
              <select
                aria-label={`Access for ${folderName(grant.path)}`}
                value={grant.access}
                onChange={(event) => grantFolder(grant.path, event.target.value as FolderAccess)}
                className="h-8 rounded-full border bg-muted/50 px-3 text-xs"
              >
                <option value="read">Read only</option>
                <option value="write">Read & write</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke ${folderName(grant.path)}`}
                onClick={() => revokeFolder(grant.path)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FolderAccessDialog />
    </section>
  );
}
