import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { IconTile, SectionHeader } from "./ui";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function FoldersSettings() {
  const grants = useFolderGrants();

  const addFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Allow a folder" });
    if (typeof folder === "string" && folder) await requestFolderAccess(folder);
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Folder access"
        description="Cowork ทำงานได้เฉพาะโฟลเดอร์ที่อนุญาตที่นี่ — โหมด Chat ไม่อ่านไฟล์ของคุณ"
        actions={
          <Button type="button" size="sm" onClick={addFolder} className="gap-1.5">
            <FolderPlusIcon className="size-4" />
            Allow folder
          </Button>
        }
      />

      {grants.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <FolderIcon className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            ยังไม่มีโฟลเดอร์ — แอปจะถามเมื่อ Cowork ต้องใช้โฟลเดอร์ครั้งแรก
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {grants.map((grant) => (
            <li key={grant.path} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <IconTile className="size-10 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <FolderIcon />
                </IconTile>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{folderName(grant.path)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground" title={grant.path}>
                    {grant.path}
                  </p>
                  <p className="text-xs text-muted-foreground">อนุญาตเมื่อ {dateFormat.format(grant.grantedAt)}</p>
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
        </ul>
      )}
      <FolderAccessDialog />
    </div>
  );
}
