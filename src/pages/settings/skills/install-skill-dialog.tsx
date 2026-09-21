import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { skillSlug, type Skill, type SkillCandidate } from "@/features/instructions";
import { readSkillAsset, type SkillAsset } from "@/features/skills";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  LoaderCircleIcon,
  SlashIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

export type InstallChoice = { candidate: SkillCandidate; files: SkillAsset[]; replaces?: Skill };

/**
 * What installing these skills will put on disk, and what each file says.
 *
 * A skill's instructions become part of what the agent is told, and its
 * scripts become files it may decide to run — so both are on the table
 * before anything is written, not after.
 */
export function InstallSkillDialog({
  candidates,
  existing,
  busy,
  onInstall,
  onClose,
}: {
  candidates: SkillCandidate[] | null;
  existing: Skill[];
  busy?: boolean;
  onInstall: (choices: InstallChoice[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    setPicked(new Set(candidates?.map((_, i) => i)));
    setQuery("");
  }, [candidates]);

  const all = candidates ?? [];
  const q = query.trim().toLowerCase();
  const shown = all
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !q || `${candidate.name} ${candidate.description}`.toLowerCase().includes(q));

  const match = (c: SkillCandidate) => existing.find((s) => skillSlug(s) === skillSlug(c));
  const kept = (c: SkillCandidate) => c.files.filter((f) => !f.skipped);
  const chosen = all.filter((_, i) => picked.has(i));
  const fileCount = chosen.reduce((total, c) => total + kept(c).length, 0);

  const toggle = (index: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const install = () =>
    onInstall(
      chosen.map((candidate) => ({ candidate, files: kept(candidate), replaces: match(candidate) })),
    );

  return (
    <Dialog open={!!candidates} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {all.length === 1 ? `Install “${all[0].name}”` : `Install skills (${all.length} found)`}
          </DialogTitle>
          <DialogDescription>
            Each one is copied to your skill library, where the AI reads it when a task matches. Nothing
            runs while installing.
          </DialogDescription>
        </DialogHeader>

        {all.length > 6 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${all.length} skills…`}
            aria-label="Filter the skills found"
            className="h-9 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        )}

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
              {shown.map(({ candidate, index }) => (
                <CandidateRow
                  key={`${candidate.source}-${index}`}
                  candidate={candidate}
                  replaces={match(candidate)}
                  picked={picked.has(index)}
                  onToggle={() => toggle(index)}
                />
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Skills come from people on the internet. Read the instructions of any you don’t recognise —
          the AI will follow them. Programs (<code className="font-mono">.exe</code>,{" "}
          <code className="font-mono">.dylib</code>…) are never copied.
        </p>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">
            {picked.size} skill{picked.size === 1 ? "" : "s"}
            {fileCount > 0 && `, ${fileCount} file${fileCount === 1 ? "" : "s"}`}
          </span>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={install} disabled={picked.size === 0 || busy} className="gap-1.5">
            {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
            {busy ? "Installing…" : `Install ${picked.size || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateRow({
  candidate,
  replaces,
  picked,
  onToggle,
}: {
  candidate: SkillCandidate;
  replaces?: Skill;
  picked: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState<"instructions" | "files" | null>(null);
  const kept = candidate.files.filter((f) => !f.skipped);
  const left = candidate.files.length - kept.length;

  return (
    <li className={cn(!picked && "opacity-55")}>
      <div className="flex min-w-0 items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={picked}
          onChange={onToggle}
          aria-label={`Install ${candidate.name}`}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{candidate.name}</span>
            {replaces && (
              <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                Replaces yours
              </span>
            )}
          </p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {candidate.description || "No “Use when”"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground/70" title={candidate.source}>
            {candidate.source.replace(/^https:\/\/(www\.)?/, "")}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Peek
              icon={FileTextIcon}
              label="Instructions"
              open={open === "instructions"}
              onToggle={() => setOpen((v) => (v === "instructions" ? null : "instructions"))}
            />
            {candidate.files.length > 0 && (
              <Peek
                icon={TerminalIcon}
                label={`${kept.length} file${kept.length === 1 ? "" : "s"}`}
                open={open === "files"}
                onToggle={() => setOpen((v) => (v === "files" ? null : "files"))}
              />
            )}
            {left > 0 && (
              <span className="text-[11px] text-muted-foreground/70">{left} left out</span>
            )}
          </div>
        </div>
      </div>

      {open === "instructions" && (
        <pre className="mx-3 mb-3 max-h-56 overflow-auto rounded-lg bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {candidate.instructions}
        </pre>
      )}
      {open === "files" && <FileList files={candidate.files} />}
    </li>
  );
}

function Peek({
  icon: Icon,
  label,
  open,
  onToggle,
}: {
  icon: typeof FileTextIcon;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon className="size-3" />
      {label}
      <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
    </button>
  );
}

/** The bundled files, with what each one contains a click away. */
function FileList({ files }: { files: SkillAsset[] }) {
  const [reading, setReading] = useState<string | null>(null);
  const [text, setText] = useState<{ path: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: SkillAsset) => {
    if (text?.path === file.path) {
      setText(null);
      return;
    }
    setReading(file.path);
    setError(null);
    try {
      setText({ path: file.path, body: await readSkillAsset(file.url) });
    } catch (e) {
      setError(`${file.path}: ${e}`);
      setText(null);
    } finally {
      setReading(null);
    }
  };

  return (
    <div className="mx-3 mb-3 flex flex-col gap-1.5 rounded-lg bg-muted/40 p-2.5">
      <ul className="flex flex-col gap-0.5">
        {files.map((file) => (
          <li key={file.path} className="flex min-w-0 items-center gap-2 text-[11px]">
            {file.skipped ? (
              <SlashIcon className="size-3 shrink-0 text-muted-foreground/60" />
            ) : (
              <CheckIcon className="size-3 shrink-0 text-muted-foreground" />
            )}
            <button
              type="button"
              disabled={!!file.skipped}
              onClick={() => void read(file)}
              className={cn(
                "min-w-0 flex-1 truncate text-left font-mono",
                file.skipped ? "text-muted-foreground/60 line-through" : "hover:underline",
              )}
              title={file.skipped ?? `Read ${file.path}`}
            >
              {file.path}
            </button>
            {reading === file.path && <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />}
            <span className="shrink-0 text-muted-foreground/70">
              {file.skipped ?? formatBytes(file.bytes)}
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      {text && (
        <pre className="max-h-48 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text.body}
        </pre>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
