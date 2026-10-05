import { useToastError } from "@/components/ui/sonner";
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
import { fetchSkillsFromNpm, fetchSkillsFromUrl, pickSkillsFolder, type SkillCandidate } from "@/features/instructions";
import { FolderOpenIcon, LinkIcon, LoaderCircleIcon, PackageIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Field } from "../ui";

/**
 * Where to find skills: a GitHub repository or folder, a link to a SKILL.md,
 * or a folder on this Mac. What it finds goes to the install dialog, which is
 * where the user decides what to keep.
 */
export function ImportSkillDialog({
  open,
  onFound,
  onClose,
}: {
  open: boolean;
  onFound: (candidates: SkillCandidate[]) => void;
  onClose: () => void;
}) {
  const urlId = useId();
  const npmId = useId();
  const [url, setUrl] = useState("");
  const [npmPackage, setNpmPackage] = useState("");
  const [busy, setBusy] = useState<"url" | "folder" | "npm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useToastError(error, () => setError(null));

  useEffect(() => {
    if (open) return;
    setUrl("");
    setNpmPackage("");
    setError(null);
  }, [open]);

  const run = async (kind: "url" | "folder" | "npm", load: () => Promise<SkillCandidate[] | null>) => {
    setBusy(kind);
    setError(null);
    try {
      const found = await load();
      if (!found) return;
      if (found.length === 0) {
        setError("Nothing to import: the SKILL.md files found were empty.");
        return;
      }
      onFound(found);
      onClose();
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

  const findFromNpm = (event: FormEvent) => {
    event.preventDefault();
    if (npmPackage.trim()) void run("npm", () => fetchSkillsFromNpm(npmPackage.trim()));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import skills</DialogTitle>
          <DialogDescription>
            From a GitHub repository or folder, an npm package, a link to a SKILL.md, or a folder your team shares.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <form onSubmit={findFromUrl}>
            <Field
              label="Link"
              htmlFor={urlId}
              hint="A repository, a folder inside one (…/tree/…), or a single SKILL.md."
            >
              <div className="flex gap-2">
                <Input
                  id={urlId}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="github.com/owner/repo"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" variant="outline" disabled={!url.trim() || !!busy} className="gap-1.5">
                  {busy === "url" ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <LinkIcon className="size-4" />
                  )}
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

          <form onSubmit={findFromNpm}>
            <Field label="npm package" htmlFor={npmId} hint="Any package that ships SKILL.md files, e.g. @org/skills.">
              <div className="flex gap-2">
                <Input
                  id={npmId}
                  value={npmPackage}
                  onChange={(e) => setNpmPackage(e.target.value)}
                  placeholder="@owner/skills-package"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" variant="outline" disabled={!npmPackage.trim() || !!busy} className="gap-1.5">
                  {busy === "npm" ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <PackageIcon className="size-4" />
                  )}
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

        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
