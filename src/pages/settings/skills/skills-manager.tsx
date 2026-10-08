import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
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
import { libraryDir, openSkillEditor, SkillsAccessError, uninstallSkill } from "@/features/skills";
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
  Package,
  PlusIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Pills, SearchField, SectionLabel, Tile, TileButton, TileGrid } from "../ui";
import { DiscoverSkills } from "./discover-skills";
import { motion } from "motion/react";
import { ImportSkillDialog } from "./import-skill-dialog";
import { InstallSkillDialog, type InstallChoice } from "./install-skill-dialog";
import { EMPTY_SKILL, SkillDialog } from "./skill-dialog";
import { menuClass, menuItemClass, SkillTile } from "./skill-row";
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
  /** Add the Discover tab (the Settings page). */
  discover?: boolean;
  /** Which tab is open, when the page keeps it (Settings routes Discover). */
  tab?: SkillsTab;
  onTabChange?: (tab: SkillsTab) => void;
};

export type SkillsTab = "yours" | "discover";

/**
 * The skill library: add, edit, install (from GitHub, a link or a folder),
 * browse public collections, and export skills to share.
 *
 * The same component serves a project's own skills, without Discover.
 */
export function SkillsManager({ skills, onSave, onToggle, onDelete, templates, emptyText, discover, ...props }: Props) {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [found, setFound] = useState<SkillCandidate[] | null>(null);
  const [ownTab, setOwnTab] = useState<SkillsTab>("yours");
  const tab = props.tab ?? ownTab;
  const setTab = props.onTabChange ?? setOwnTab;
  const [query, setQuery] = useState("");
  const [newSkillDraft, setNewSkillDraft] = useState<SkillDraft | null>(null);
  const { busy, install } = useSkillInstall(onSave, skills);

  const editSkill = (skill: Skill | SkillDraft) =>
    report(async () => {
      await openSkillEditor(navigate, skill, onSave);
      return null;
    });

  const report = async (work: () => Promise<string | null>) => {
    const retry = () => report(work);
    try {
      const text = await work();
      if (text) toast.success(text);
    } catch (error) {
      if (error instanceof SkillsAccessError) {
        toast.error("Cowork can’t write to the skills folder", {
          description: error.message,
          action: { label: "Try again", onClick: () => void retry() },
        });
        return;
      }
      toast.error("Something went wrong", {
        description: error instanceof Error ? error.message : String(error),
      });
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
  const q = tab === "yours" ? query.trim().toLowerCase() : "";
  const shown = q
    ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q))
    : skills;
  // Found somewhere (GitHub, a link, a file) or written here.
  const installed = shown.filter((s) => s.source || s.via);
  const written = shown.filter((s) => !s.source && !s.via);
  const shownTemplates = q ? unused.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q)) : unused;

  const tile = (skill: Skill) => (
    <SkillTile
      key={skill.id}
      skill={skill}
      actions={{
        onEdit: () => editSkill(skill),
        onToggle: (enabled) => onToggle(skill.id, enabled),
        onDelete: () => remove(skill),
        onExport: () =>
          void report(async () => ((await exportSkillFile(skill)) ? `Exported “${skill.name}”` : null)),
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
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {discover ? (
          <Pills
            label="Skills"
            value={tab}
            onChange={setTab}
            options={[
              { value: "yours", label: "Your skills", count: skills.length },
              { value: "discover", label: "Discover" },
            ]}
          />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(discover || skills.length > 6) && (
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={tab === "discover" ? "Search GitHub for skills…" : "Search your skills…"}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5">
                <FileUpIcon className="size-4" />
                Install
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
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
          <Button type="button" size="sm" className="h-9 gap-1.5" onClick={() => setNewSkillDraft({ ...EMPTY_SKILL })}>
            <PlusIcon className="size-4" />
            New skill
          </Button>
        </div>
      </div>

      {/* Keyed by tab so each switch slides the new list in from the side. */}
      <motion.div
        key={tab}
        className="flex flex-col gap-6"
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
        transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
      >
        {discover && tab === "discover" ? (
          <DiscoverSkills query={query} installed={skills} onPick={setFound} />
        ) : (
          <>
            {shown.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {q ? `No skills match “${query.trim()}”.` : emptyText}
              </p>
            )}
            <SkillSection title="Written by you" count={written.length}>
              {written.map(tile)}
            </SkillSection>
            <SkillSection title="Installed" count={installed.length}>
              {installed.map(tile)}
            </SkillSection>
            <SkillSection title="Start from a template" count={shownTemplates.length}>
              {shownTemplates.map((template) => {
                const add = () => void editSkill({ ...template, enabled: true });
                return (
                  <Tile
                    key={template.name}
                    icon={
                      <span className="flex size-8 items-center justify-center rounded-lg">
                        <Package style={{ width: 16, height: 16 }} />
                      </span>
                    }
                    title={template.name}
                    description={template.description}
                    onOpen={add}
                    openLabel={`Add ${template.name}`}
                    action={
                      <TileButton label={`Add ${template.name}`} onClick={add}>
                        <PlusIcon />
                      </TileButton>
                    }
                  />
                );
              })}
            </SkillSection>
          </>
        )}
      </motion.div>

      <SkillDialog
        draft={newSkillDraft}
        onSave={(draft) => {
          setNewSkillDraft(null);
          void editSkill(draft);
        }}
        onClose={() => setNewSkillDraft(null)}
      />
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

function SkillSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>
        {title} <span className="ml-1 font-normal tabular-nums">· {count}</span>
      </SectionLabel>
      <TileGrid>{children}</TileGrid>
    </section>
  );
}
