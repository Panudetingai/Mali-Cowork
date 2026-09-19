import { DiffStat } from "@/components/diff/diff-view";
import { CodeDiff } from "@/components/diff/code-diff";
import type { FileDiff } from "@/components/diff/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
    ChevronRightIcon,
    FileCode2Icon,
    FileIcon,
    FileTextIcon,
    ImageIcon,
    ListTreeIcon,
    LoaderIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type DiffFile = {
  /** Unique within the list. */
  key: string;
  path: string;
  origPath?: string;
  kind: "added" | "modified" | "deleted" | "renamed" | "conflicted";
  additions?: number;
  deletions?: number;
};

const KIND_LABEL: Partial<Record<DiffFile["kind"], { text: string; className: string }>> = {
  added: { text: "New", className: "text-emerald-600 dark:text-emerald-400" },
  deleted: { text: "Deleted", className: "text-red-600 dark:text-red-400" },
  renamed: { text: "Renamed", className: "text-sky-600 dark:text-sky-400" },
  conflicted: { text: "Conflict", className: "text-red-600 dark:text-red-400" },
};

function FileKindIcon({ path, className }: { path: string; className?: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const Icon = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)
    ? ImageIcon
    : ["md", "txt", "docx", "pdf", "rtf"].includes(ext)
      ? FileTextIcon
      : ext && ext !== path.toLowerCase()
        ? FileCode2Icon
        : FileIcon;
  return <Icon className={cn("size-4 shrink-0 text-sky-500 dark:text-sky-400", className)} />;
}

type Props = {
  files: DiffFile[];
  loadDiff: (file: DiffFile) => Promise<FileDiff>;
  /** Changes when diffs may be stale (after an action or agent run). */
  reloadKey?: string | number;
  /** Controls at the right of each file's header (stage box, menu). */
  actions?: (file: DiffFile) => ReactNode;
  /** Extra controls in the summary row. */
  summaryActions?: ReactNode;
};

/** Every file's diff one after another, like a pull request's "Files changed". */
export function FileDiffList({ files, loadDiff, reloadKey, actions, summaryActions }: Props) {
  const sections = useRef(new Map<string, HTMLElement>());
  const [listOpen, setListOpen] = useState(false);
  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);

  const jumpTo = (key: string) => {
    setListOpen(false);
    sections.current.get(key)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">
          {files.length} {files.length === 1 ? "File" : "Files"} Changed
        </span>
        <DiffStat additions={additions} deletions={deletions} className="text-[13px]" />
        <div className="ml-auto flex items-center gap-1">
          {summaryActions}
          <Popover open={listOpen} onOpenChange={setListOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Files"
                aria-label="Show the list of files"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ListTreeIcon className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-[60vh] w-80 gap-0 overflow-y-auto p-1.5">
              {files.map((file) => (
                <button
                  key={file.key}
                  type="button"
                  onClick={() => jumpTo(file.key)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <FileKindIcon path={file.path} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate [direction:rtl] text-left" title={file.path}>
                    &lrm;{file.path}
                  </span>
                  <DiffStat additions={file.additions} deletions={file.deletions} />
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {files.map((file) => (
        <FileSection
          key={file.key}
          file={file}
          loadDiff={loadDiff}
          reloadKey={reloadKey}
          actions={actions?.(file)}
          register={(el) => {
            if (el) sections.current.set(file.key, el);
            else sections.current.delete(file.key);
          }}
        />
      ))}
    </div>
  );
}

function FileSection({
  file,
  loadDiff,
  reloadKey,
  actions,
  register,
}: {
  file: DiffFile;
  loadDiff: (file: DiffFile) => Promise<FileDiff>;
  reloadKey?: string | number;
  actions?: ReactNode;
  register: (el: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(true);
  const [near, setNear] = useState(false);
  const [diff, setDiff] = useState<FileDiff>();
  const [error, setError] = useState<string>();

  // Load a file's diff only as it scrolls close to view.
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: "800px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !open) return;
    let cancelled = false;
    loadDiff(file)
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        setError(undefined);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
    // `file.path` + counts identify the content; `reloadKey` forces a refresh.
  }, [near, open, file.path, file.origPath, file.additions, file.deletions, reloadKey, loadDiff]);

  const label = KIND_LABEL[file.kind];
  return (
    <section
      ref={(el) => {
        ref.current = el;
        register(el);
      }}
      className="border-b"
    >
      <header
        className={cn(
          "sticky top-0 z-10 flex min-w-0 items-center gap-2 bg-background/95 px-3 py-2 backdrop-blur",
          open && "border-b border-border/60",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        >
          <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <FileKindIcon path={file.path} />
          <span className="min-w-0 truncate text-[13px]">{file.path}</span>
          <DiffStat additions={file.additions} deletions={file.deletions} className="text-[12px]" />
        </button>
        {label && <span className={cn("shrink-0 text-xs", label.className)}>{label.text}</span>}
        {actions}
      </header>
      {open && (
        <div>
          {error ? (
            <p className="whitespace-pre-wrap px-4 py-4 text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : diff ? (
            <CodeDiff diff={diff} path={file.path} />
          ) : (
            <div className="flex justify-center py-6 text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
