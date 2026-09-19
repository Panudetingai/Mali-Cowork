import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDraft } from "@/features/projects";
import { folderName, normalizeFolder, requestFolderAccess } from "@/features/workspace";
import { Field } from "@/pages/settings/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

export const EMPTY_PROJECT: ProjectDraft = { name: "", description: "", instructions: "", folder: undefined };

/** Create a project, or edit its name, description, folder and instructions. */
export function ProjectDialog({
  draft,
  editing,
  onSave,
  onClose,
}: {
  draft: ProjectDraft | null;
  editing?: boolean;
  onSave: (draft: ProjectDraft) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProjectDraft>(EMPTY_PROJECT);
  const ids = { name: useId(), description: useId(), instructions: useId() };

  useEffect(() => {
    if (draft) setForm(draft);
  }, [draft]);

  const pickFolder = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      defaultPath: form.folder || undefined,
      title: "Choose the project’s folder",
    });
    if (typeof folder !== "string" || !folder) return;
    // Cowork may only use folders the user allowed.
    if (!(await requestFolderAccess(folder))) return;
    setForm((f) => ({ ...f, folder: normalizeFolder(folder) }));
  };

  const save = () => {
    if (!form.name.trim()) return;
    onSave(form);
    onClose();
  };

  return (
    <Dialog open={!!draft} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            Keep related chats together, with instructions and skills they all share.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Name" htmlFor={ids.name}>
            <Input
              id={ids.name}
              value={form.name}
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="e.g. Q4 marketing report"
            />
          </Field>
          <Field label="What it’s about" htmlFor={ids.description} optional>
            <Input
              id={ids.description}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Quarterly report for the leadership team"
            />
          </Field>
          <Field
            label="Folder"
            optional
            hint="New Cowork chats in this project work in this folder."
          >
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start gap-2" onClick={pickFolder}>
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate" title={form.folder}>
                  {form.folder ? folderName(form.folder) : "Choose a folder…"}
                </span>
              </Button>
              {form.folder && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove folder"
                  onClick={() => setForm((f) => ({ ...f, folder: undefined }))}
                >
                  <XIcon className="size-4" />
                </Button>
              )}
            </div>
          </Field>
          <Field
            label="Project instructions"
            htmlFor={ids.instructions}
            optional
            hint="Every chat in this project follows these, on top of your custom instructions."
          >
            <Textarea
              id={ids.instructions}
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              placeholder={"e.g. Audience: executives. Use the numbers in /data only.\nWrite in Thai, keep product names in English."}
              className="max-h-64 min-h-28 text-sm"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!form.name.trim()}>
            {editing ? "Save" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
