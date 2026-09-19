import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  folderName,
  grantFolder,
  requestFolderAccess,
  revokeFolder,
  useFolderGrants,
  type FolderAccess,
} from "@/features/workspace";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderIcon, FolderPlusIcon, Trash2Icon } from "lucide-react";
import { EmptyState, IconTile, SectionHeader, SettingsList } from "./ui";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function FoldersSettings() {
  const grants = useFolderGrants();

  const addFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Allow a folder" });
    if (typeof folder === "string" && folder) await requestFolderAccess(folder);
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Folder access"
        description="Cowork can only use folders you allow here. Chat never reads your files."
        actions={
          <Button type="button" size="sm" onClick={addFolder} className="gap-1.5">
            <FolderPlusIcon className="size-4" />
            Allow folder
          </Button>
        }
      />

      {grants.length === 0 ? (
        <EmptyState
          icon={<FolderIcon />}
          title="No folders allowed yet"
          description="You’ll be prompted when Cowork first needs access. You can also add one now."
          action={
            <Button type="button" size="sm" variant="outline" onClick={addFolder} className="gap-1.5">
              <FolderPlusIcon className="size-4" />
              Allow folder
            </Button>
          }
        />
      ) : (
        <SettingsList>
          {grants.map((grant) => (
            <li key={grant.path} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <IconTile className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <FolderIcon />
                </IconTile>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{folderName(grant.path)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground" title={grant.path}>
                    {grant.path}
                  </p>
                  <p className="text-xs text-muted-foreground">Allowed {dateFormat.format(grant.grantedAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Select
                  value={grant.access}
                  onValueChange={(value) => grantFolder(grant.path, value as FolderAccess)}
                >
                  <SelectTrigger size="sm" aria-label={`Access for ${folderName(grant.path)}`} className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Read only</SelectItem>
                    <SelectItem value="write">Read & write</SelectItem>
                  </SelectContent>
                </Select>
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
              </div>
            </li>
          ))}
        </SettingsList>
      )}
    </div>
  );
}
