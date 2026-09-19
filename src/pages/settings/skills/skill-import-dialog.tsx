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
import {
  fetchSkillsFromUrl,
  pickSkillsFolder,
  skillSlug,
  type Skill,
  type SkillCandidate,
} from "@/features/instructions";
import { cn } from "@/lib/utils";
import { FolderOpenIcon, LinkIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Field, Notice } from "../ui";

export type ImportChoice = { candidate: SkillCandidate; replaces?: Skill };

/**
 * Import skills from a GitHub repository, a SKILL.md link, or a folder.
 * Shows what was found so the user picks what to add; a skill with the same
 * name as an existing one updates it.
 */
export function SkillImportDialog({
  open,
  existing,
  onImport,
  onClose,
}: {
  open: boolean;
  existing: Skill[];
  onImport: (choices: ImportChoice[]) => void;
  onClose: () => void;
}) {
  const urlId = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"url" | "folder" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<SkillCandidate[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) return;
    setUrl("");
    setError(null);
    setFound([]);
    setSelected(new Set());
  }, [open]);

  const show = (candidates: SkillCandidate[]) => {
    setFound(candidates);
    setSelected(new Set(candidates.map((_, i) => i)));
    if (candidates.length === 0) setError("Nothing to import: the SKILL.md files found were empty.");
  };

  const run = async (kind: "url" | "folder", load: () => Promise<SkillCandidate[] | null>) => {
    setBusy(kind);
    setError(null);
    try {
      const candidates = await load();
      if (candidates) show(candidates);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const findFromUrl = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) void run("url", () => fetchSkillsFromUrl(url.trim()));
  };

  const match = (c: SkillCandidate) => existing.find((s) => skillSlug(s) === skillSlug(c));

  const importSelected = () => {
    onImport(found.filter((_, i) => selected.has(i)).map((candidate) => ({ candidate, replaces: match(candidate) })));
    onClose();
  };

  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import skills</DialogTitle>
          <DialogDescription>
            From a GitHub repository or folder, a link to a SKILL.md, or a folder your team shares.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <form onSubmit={findFromUrl}>
            <Field
              label="Link"
              htmlFor={urlId}
              hint="e.g. https://github.com/anthropics/skills or …/tree/main/skills/pdf"
            >
              <div className="flex gap-2">
                <Input
                  id={urlId}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" variant="outline" disabled={!url.trim() || !!busy} className="gap-1.5">
                  {busy === "url" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <LinkIcon className="size-4" />}
                  Find
                </Button>
              </div>
            </Field>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="gap-1.5 self-start"
            disabled={!!busy}
            onClick={() => void run("folder", pickSkillsFolder)}
          >
            {busy === "folder" ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <FolderOpenIcon className="size-4" />
            )}
            Choose a folder…
          </Button>

          {error && (
            <Notice tone="danger" onDismiss={() => setError(null)}>
              {error}
            </Notice>
          )}

          {found.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm font-medium">
                Found {found.length} skill{found.length === 1 ? "" : "s"}
              </p>
              <ul className="flex max-h-64 min-w-0 flex-col divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/60">
                {found.map((candidate, index) => {
                  const replaces = match(candidate);
                  return (
                    <li key={`${candidate.source}-${index}`}>
                      <label
                        className={cn(
                          "flex min-w-0 cursor-pointer items-start gap-3 p-3 hover:bg-muted/30",
                          !selected.has(index) && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(index)}
                          onChange={() => toggle(index)}
                          className="mt-1 size-4 shrink-0 accent-primary"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">{candidate.name}</span>
                            {replaces && (
                              <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                                Updates yours
                              </span>
                            )}
                          </span>
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {candidate.description || "No “Use when”"}
                          </span>
                          <span className="truncate text-[11px] text-muted-foreground/70" title={candidate.source}>
                            {candidate.source}
                          </span>
                        </span>
                      </label>
                      {/* Imported text becomes part of the AI's instructions, so it can be read first. */}
                      <details className="px-3 pb-3 pl-10">
                        <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
                          Read instructions
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {candidate.instructions}
                        </pre>
                      </details>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Only each SKILL.md’s text is imported. Scripts or other files in a skill’s folder are not
                downloaded or run.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={importSelected} disabled={selected.size === 0 || found.length === 0}>
            Import {selected.size > 0 ? selected.size : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
