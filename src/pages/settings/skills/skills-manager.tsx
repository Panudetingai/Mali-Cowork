import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  copySkillFile,
  exportSkillFile,
  exportSkillsToFolder,
  fromSkillFile,
  SKILL_TEMPLATES,
  type Skill,
} from "@/features/instructions";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  ClipboardCopyIcon,
  DownloadIcon,
  FileUpIcon,
  FolderDownIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { IconTile, Notice, SettingsList } from "../ui";
import { EMPTY_SKILL, SkillDialog, type SkillDraft } from "./skill-dialog";
import { SkillImportDialog, type ImportChoice } from "./skill-import-dialog";

const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
const menuClass = "z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";

type Props = {
  skills: Skill[];
  onSave: (skill: SkillDraft) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  /** Offer the built-in templates when they aren't added yet. */
  templates?: boolean;
  /** Shown when there are no skills yet. */
  emptyText?: string;
};

/** The skill library: add, edit, import (file, link, Git, folder) and export skills. */
export function SkillsManager({ skills, onSave, onToggle, onDelete, templates, emptyText }: Props) {
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  const report = async (work: () => Promise<string | null>) => {
    try {
      const text = await work();
      if (text) setMessage({ tone: "info", text });
    } catch (error) {
      setMessage({ tone: "danger", text: String(error) });
    }
  };

  const importFile = () =>
    report(async () => {
      const path = await open({
        multiple: false,
        title: "Import a skill",
        filters: [{ name: "Skill (Markdown)", extensions: ["md", "markdown", "txt"] }],
      });
      if (typeof path !== "string") return null;
      const text = await readTextFile(path);
      const parts = path.split(/[\\/]/);
      const name = parts.at(-1) ?? "Skill";
      // `…/my-skill/SKILL.md` is named after its folder.
      const folder = parts.at(-2);
      setDraft({ ...fromSkillFile(text, /^skill\.md$/i.test(name) && folder ? folder : name), source: path });
      return null;
    });

  const importChoices = (choices: ImportChoice[]) => {
    for (const { candidate, replaces } of choices) {
      onSave({ ...candidate, id: replaces?.id, enabled: replaces?.enabled ?? true });
    }
    const updated = choices.filter((c) => c.replaces).length;
    const added = choices.length - updated;
    const parts = [
      added > 0 && `${added} added`,
      updated > 0 && `${updated} updated`,
    ].filter(Boolean);
    setMessage({ tone: "info", text: `Skills imported: ${parts.join(", ")}.` });
  };

  const exportAll = () =>
    report(async () => {
      const result = await exportSkillsToFolder(skills);
      return result && `Exported ${result.count} skill${result.count === 1 ? "" : "s"} to ${result.folder}`;
    });

  const unused = templates ? SKILL_TEMPLATES.filter((t) => !skills.some((s) => s.name === t.name)) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="gap-1.5" onClick={() => setDraft(EMPTY_SKILL)}>
          <PlusIcon className="size-4" />
          New skill
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="gap-1.5">
              <FileUpIcon className="size-4" />
              Import
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className={menuClass}>
            <DropdownMenuItem className={menuItemClass} onSelect={() => void importFile()}>
              <FileUpIcon className="size-4 text-muted-foreground" />
              SKILL.md file…
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onSelect={() => setImporting(true)}>
              <GlobeIcon className="size-4 text-muted-foreground" />
              From GitHub, a link or a folder…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {skills.length > 0 && (
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => void exportAll()}>
            <FolderDownIcon className="size-4" />
            Export all
          </Button>
        )}
      </div>

      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      {skills.length > 0 ? (
        <SettingsList>
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-center gap-3 p-4">
              <IconTile className="bg-violet-500/10 text-violet-700 dark:text-violet-400">
                <SparklesIcon />
              </IconTile>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{skill.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {skill.description ? `Use when: ${skill.description}` : "No “Use when” yet"}
                </p>
                {skill.source && (
                  <p className="truncate text-[11px] text-muted-foreground/70" title={skill.source}>
                    From {skill.source.replace(/^https:\/\//, "")}
                  </p>
                )}
              </div>
              <Switch
                checked={skill.enabled}
                onCheckedChange={(enabled) => onToggle(skill.id, enabled)}
                aria-label={`Use ${skill.name}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${skill.name}`}
                onClick={() => setDraft(skill)}
              >
                <PencilIcon className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`More for ${skill.name}`}>
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
                  <DropdownMenuItem
                    className={menuItemClass}
                    onSelect={() => void report(async () => ((await exportSkillFile(skill)) ? `Exported “${skill.name}”` : null))}
                  >
                    <DownloadIcon className="size-4 text-muted-foreground" />
                    Export SKILL.md…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={menuItemClass}
                    onSelect={() =>
                      void report(async () => {
                        await copySkillFile(skill);
                        return `Copied “${skill.name}” as SKILL.md — paste it to share with your team`;
                      })
                    }
                  >
                    <ClipboardCopyIcon className="size-4 text-muted-foreground" />
                    Copy as SKILL.md
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                  <DropdownMenuItem
                    className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive")}
                    onSelect={() => onDelete(skill.id)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </SettingsList>
      ) : (
        emptyText && <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}

      {unused.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/15 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <WandSparklesIcon className="size-4 text-muted-foreground" />
            Start from a template
          </p>
          <div className="flex flex-wrap gap-2">
            {unused.map((template) => (
              <Button
                key={template.name}
                type="button"
                size="sm"
                variant="outline"
                title={template.description}
                onClick={() => onSave({ ...template, enabled: true })}
              >
                <PlusIcon className="size-3.5" />
                {template.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <SkillDialog draft={draft} onSave={onSave} onClose={() => setDraft(null)} />
      <SkillImportDialog
        open={importing}
        existing={skills}
        onImport={importChoices}
        onClose={() => setImporting(false)}
      />
    </div>
  );
}
