import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  copySkillFile,
  exportSkillFile,
  exportSkillsToFolder,
  fromSkillFile,
  SKILL_TEMPLATES,
  type Skill,
  type SkillCandidate,
  type SkillDraft,
} from "@/features/instructions";
import { libraryDir, openSkillEditor, uninstallSkill } from "@/features/skills";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CompassIcon,
  FileUpIcon,
  FolderDownIcon,
  FolderOpenIcon,
  GlobeIcon,
  PlusIcon,
  SearchIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { FilterPills } from "../mcp/discover-view";
import { Notice } from "../ui";
import { DiscoverSkills } from "./discover-skills";
import { ImportSkillDialog } from "./import-skill-dialog";
import { InstallSkillDialog, type InstallChoice } from "./install-skill-dialog";
import { EMPTY_SKILL } from "./skill-dialog";
import { menuClass, menuItemClass, SkillRow } from "./skill-row";
import { describeInstall, useSkillInstall } from "./use-skill-install";

type Props = {
  skills: Skill[];
  onSave: (skill: SkillDraft) => string;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  /** Offer the built-in templates when they aren't added yet. */
  templates?: boolean;
  /** Shown when there are no skills yet. */
  emptyText?: string;
  /** Add the search box and the Discover tab (the Settings page). */
  discover?: boolean;
};

type Tab = "yours" | "discover";

/**
 * The skill library: add, edit, install (from GitHub, a link or a folder),
 * browse public collections, and export skills to share.
 *
 * The same component serves a project's own skills, without Discover.
 */
export function SkillsManager({ skills, onSave, onToggle, onDelete, templates, emptyText, discover }: Props) {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [found, setFound] = useState<SkillCandidate[] | null>(null);
  const [tab, setTab] = useState<Tab>("yours");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const { busy, install } = useSkillInstall(onSave, skills);

  const editSkill = (skill: Skill | SkillDraft) =>
    report(async () => {
      await openSkillEditor(navigate, skill, onSave);
      return null;
    });

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
      const draft = { ...fromSkillFile(text, /^skill\.md$/i.test(name) && folder ? folder : name), source: path };
      await openSkillEditor(navigate, draft, onSave);
      return null;
    });

  const runInstall = (choices: InstallChoice[]) =>
    void report(async () => {
      const result = await install(choices);
      setFound(null);
      setTab("yours");
      return describeInstall(result);
    });

  /** Deleting takes the folder with it, so nothing is left behind on disk. */
  const remove = (skill: Skill) => {
    onDelete(skill.id);
    if (skill.install) void uninstallSkill(skill.install.slug).catch(() => undefined);
  };

  const exportAll = () =>
    report(async () => {
      const result = await exportSkillsToFolder(skills);
      return result && `Exported ${result.count} skill${result.count === 1 ? "" : "s"} to ${result.folder}`;
    });

  const openLibrary = () =>
    report(async () => {
      await revealItemInDir(`${await libraryDir()}/`);
      return null;
    });

  const unused = templates ? SKILL_TEMPLATES.filter((t) => !skills.some((s) => s.name === t.name)) : [];
  const q = discover && tab === "yours" ? query.trim().toLowerCase() : "";
  const shown = q
    ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q))
    : skills;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {discover && (
          <div className="relative order-last w-full sm:order-none sm:mr-auto sm:max-w-sm sm:flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={tab === "discover" ? "Search GitHub for skills" : "Search your skills"}
              aria-label="Search skills"
              className="h-9 rounded-lg pl-8"
            />
          </div>
        )}
        <Button type="button" size="sm" className="gap-1.5" onClick={() => void editSkill(EMPTY_SKILL)}>
          <PlusIcon className="size-4" />
          New skill
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="gap-1.5">
              <FileUpIcon className="size-4" />
              Install
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className={menuClass}>
            {discover && (
              <DropdownMenuItem className={menuItemClass} onSelect={() => setTab("discover")}>
                <CompassIcon className="size-4 text-muted-foreground" />
                Browse public skills
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={menuItemClass} onSelect={() => setImporting(true)}>
              <GlobeIcon className="size-4 text-muted-foreground" />
              From GitHub, a link or a folder…
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onSelect={() => void importFile()}>
              <FileUpIcon className="size-4 text-muted-foreground" />
              A single SKILL.md file…
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
            {skills.length > 0 && (
              <DropdownMenuItem className={menuItemClass} onSelect={() => void exportAll()}>
                <FolderDownIcon className="size-4 text-muted-foreground" />
                Export all to a folder…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={menuItemClass} onSelect={() => void openLibrary()}>
              <FolderOpenIcon className="size-4 text-muted-foreground" />
              Show the skills folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {discover && (
        <FilterPills
          value={tab}
          onChange={setTab}
          options={[
            ["yours", `Your skills${skills.length ? ` (${skills.length})` : ""}`],
            ["discover", "Discover"],
          ]}
        />
      )}

      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      {discover && tab === "discover" ? (
        <DiscoverSkills query={query} installed={skills} onPick={setFound} />
      ) : (
        <>
          {shown.length > 0 ? (
            <div className="flex flex-col">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 pb-2 text-sm text-muted-foreground sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                <span>Skill</span>
                <span className="hidden sm:block">How it’s used</span>
                <span>Use it</span>
              </div>
              <ul className="flex flex-col">
                {shown.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    actions={{
                      onEdit: () => editSkill(skill),
                      onToggle: (enabled) => onToggle(skill.id, enabled),
                      onDelete: () => remove(skill),
                      onExport: () =>
                        void report(async () =>
                          (await exportSkillFile(skill)) ? `Exported “${skill.name}”` : null,
                        ),
                      onCopy: () =>
                        void report(async () => {
                          await copySkillFile(skill);
                          return `Copied “${skill.name}” as SKILL.md — paste it to share with your team`;
                        }),
                      onReveal: skill.install
                        ? () =>
                            void report(async () => {
                              await revealItemInDir(`${skill.install?.dir}/SKILL.md`);
                              return null;
                            })
                        : undefined,
                    }}
                  />
                ))}
              </ul>
            </div>
          ) : q ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No skills match “{query.trim()}”.
            </p>
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
                    onClick={() => void editSkill({ ...template, enabled: true })}
                  >
                    <PlusIcon className="size-3.5" />
                    {template.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <ImportSkillDialog open={importing} onFound={setFound} onClose={() => setImporting(false)} />
      <InstallSkillDialog
        candidates={found}
        existing={skills}
        busy={busy}
        onInstall={runInstall}
        onClose={() => setFound(null)}
      />
    </div>
  );
}
