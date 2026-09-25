"use client";

import {
  Checkbox,
  CheckboxIndicator,
} from "@/components/animate-ui/primitives/radix/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
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
import { VirtualList } from "@/components/ui/virtual-list";
import { FilePreviewDialog, openCheckpointFile, type FileChange } from "@/features/checkpoints";
import { useChatSessions } from "@/features/chat-history";
import { getProject } from "@/features/projects";
import { cn } from "@/lib/utils";
import {
  ArrowDownUpIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  ImageIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PresentationIcon,
  SearchIcon,
  SquareArrowOutUpRightIcon,
  Table2Icon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { statOutputs, trashOutputs } from "./api";
import { listOutputs } from "./outputs";
import { hideOutputs, unhideOutputs, useHiddenOutputs } from "./outputs-hidden";
import type { OutputItem, OutputKind, OutputStat, OutputsQuery } from "./types";

type Props = {
  /** Base filters, e.g. { projectId: ... } for a project tab. */
  query?: OutputsQuery;
  /** Shown when the list is empty. */
  empty: ReactNode;
  className?: string;
};

const ITEM_HEIGHT = 68;
/** `outputs_stat` answers at most this many per call. */
const STAT_BATCH = 500;

const KIND_META: Record<
  OutputKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  document: { label: "Documents", icon: FileTextIcon, color: "text-sky-600 dark:text-sky-400" },
  sheet: { label: "Sheets", icon: Table2Icon, color: "text-emerald-600 dark:text-emerald-400" },
  slides: { label: "Slides", icon: PresentationIcon, color: "text-violet-600 dark:text-violet-400" },
  pdf: { label: "PDFs", icon: FileTextIcon, color: "text-red-600 dark:text-red-400" },
  image: { label: "Images", icon: ImageIcon, color: "text-amber-600 dark:text-amber-400" },
  code: { label: "Code", icon: CodeIcon, color: "text-indigo-600 dark:text-indigo-400" },
  other: { label: "Other", icon: FileIcon, color: "text-muted-foreground" },
};

const ALL_KINDS = Object.keys(KIND_META) as OutputKind[];

const SORTS = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name",
  size: "Largest first",
} as const;
type Sort = keyof typeof SORTS;

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const REVEAL = isMac ? "Show in Finder" : "Show in folder";
const TRASH = isMac ? "Trash" : "Recycle Bin";

const menuClass = "z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";
const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-muted";

function formatWhen(time: number) {
  const date = new Date(time);
  const now = new Date();
  const time24 = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today ${time24}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time24}`;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** The folder a file sits in, as the user knows it. */
function folderOf(output: OutputItem) {
  const parts = output.path.split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

type Notice = { tone: "info" | "error"; text: string; undo?: () => void };

export function OutputsList({ query = {}, empty, className }: Props) {
  const sessions = useChatSessions();
  const hidden = useHiddenOutputs();
  const navigate = useNavigate();
  const [previewing, setPreviewing] = useState<OutputItem | null>(null);
  const [search, setSearch] = useState(query.search ?? "");
  const [kinds, setKinds] = useState<OutputKind[]>(query.kinds ?? []);
  const [sort, setSort] = useState<Sort>("newest");
  const [stats, setStats] = useState<Map<string, OutputStat>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmTrash, setConfirmTrash] = useState<OutputItem[] | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Callers pass `query` inline (or not at all), so it's a new object every
  // render; keyed by its values instead, or the list and the file checks
  // below would rerun on every render.
  const { projectId, since, includeUndone } = query;
  const baseQuery: OutputsQuery = useMemo(
    () => ({ projectId, since, includeUndone }),
    [projectId, since, includeUndone],
  );
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  // Everything this page could show; filters and sorting apply on top.
  const all = useMemo(
    () => listOutputs(sessions, baseQuery).filter((o) => !hiddenSet.has(o.path)),
    [sessions, baseQuery, hiddenSet],
  );

  // Every file is checked, not only the visible ones: the missing count,
  // sizes and "Largest first" need them all. It's one metadata read each.
  // Asked once per path per visit, even while an earlier batch is in flight.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const unchecked = all.filter((o) => !requested.current.has(o.path));
    if (unchecked.length === 0) return;
    const timer = setTimeout(async () => {
      for (const o of unchecked) requested.current.add(o.path);
      for (let i = 0; i < unchecked.length; i += STAT_BATCH) {
        const batch = unchecked.slice(i, i + STAT_BATCH);
        try {
          const results = await statOutputs(batch);
          setStats((prev) => {
            const next = new Map(prev);
            for (const result of results) next.set(result.path, result);
            return next;
          });
        } catch (error) {
          // Asked again the next time the list changes.
          for (const o of batch) requested.current.delete(o.path);
          console.warn("[outputs] couldn't check files:", error);
        }
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [all]);

  const kindCounts = useMemo(() => {
    const counts = new Map<OutputKind, number>();
    for (const output of all) counts.set(output.kind, (counts.get(output.kind) ?? 0) + 1);
    return counts;
  }, [all]);

  const outputs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = all.filter(
      (o) =>
        (kinds.length === 0 || kinds.includes(o.kind)) &&
        (!needle ||
          o.name.toLowerCase().includes(needle) ||
          o.relative.toLowerCase().includes(needle) ||
          o.chatTitle?.toLowerCase().includes(needle)),
    );
    const size = (o: OutputItem) => stats.get(o.path)?.size ?? o.size ?? 0;
    return list.sort((a, b) =>
      sort === "oldest"
        ? a.createdAt - b.createdAt
        : sort === "name"
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
          : sort === "size"
            ? size(b) - size(a)
            : b.createdAt - a.createdAt,
    );
  }, [all, kinds, search, sort, stats]);

  const missing = useMemo(() => all.filter((o) => stats.get(o.path)?.exists === false), [all, stats]);
  const selecting = selected.size > 0;
  const selectedItems = outputs.filter((o) => selected.has(o.path));
  const allSelected = outputs.length > 0 && selectedItems.length === outputs.length;

  // Selection follows what's listed: a file filtered out is no longer selected.
  useEffect(() => {
    setSelected((prev) => {
      const listed = new Set(outputs.map((o) => o.path));
      const next = new Set([...prev].filter((p) => listed.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [outputs]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const removeFromList = (items: OutputItem[]) => {
    const paths = items.map((o) => o.path);
    hideOutputs(paths);
    setSelected(new Set());
    setNotice({
      tone: "info",
      text: `${paths.length === 1 ? `“${items[0].name}” was` : `${paths.length} files were`} removed from the list. The ${paths.length === 1 ? "file stays" : "files stay"} on disk.`,
      undo: () => {
        unhideOutputs(paths);
        setNotice(null);
      },
    });
  };

  const moveToTrash = async (items: OutputItem[]) => {
    setTrashing(true);
    try {
      const results = await trashOutputs(items);
      const done = results.filter((r) => r.ok).map((r) => r.path);
      const failed = results.filter((r) => !r.ok);
      hideOutputs(done);
      setSelected(new Set());
      setStats((prev) => {
        const next = new Map(prev);
        for (const path of done) next.set(path, { path, exists: false });
        return next;
      });
      if (failed.length) {
        setNotice({
          tone: "error",
          text: `${done.length ? `Moved ${done.length} to the ${TRASH}. ` : ""}Couldn't move ${failed.length}: ${failed[0].error ?? "unknown error"}`,
        });
      } else {
        setNotice({
          tone: "info",
          text: `Moved ${done.length === 1 ? `“${items[0].name}”` : `${done.length} files`} to the ${TRASH}. You can put ${done.length === 1 ? "it" : "them"} back from there.`,
        });
      }
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setTrashing(false);
      setConfirmTrash(null);
    }
  };

  const open = (output: OutputItem, reveal = false) =>
    openCheckpointFile(output.checkpointId, output.path, reveal).catch((error) =>
      setNotice({ tone: "error", text: String(error) }),
    );

  const copyPath = (output: OutputItem) =>
    navigator.clipboard
      .writeText(output.path)
      .then(() => setNotice({ tone: "info", text: `Copied the path of “${output.name}”.` }))
      .catch(() => setNotice({ tone: "error", text: "Couldn't copy to the clipboard." }));

  const previewChange: FileChange | undefined = previewing
    ? { path: previewing.path, relative: previewing.relative, kind: "added", size: previewing.size, restorable: true }
    : undefined;

  const actions: RowActions = {
    preview: setPreviewing,
    open: (o) => void open(o),
    reveal: (o) => void open(o, true),
    copyPath: (o) => void copyPath(o),
    openChat: (o) => navigate(`/chat/${o.chatId}`),
    remove: (o) => removeFromList([o]),
    trash: (o) => setConfirmTrash([o]),
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      {/* Filters, search and sort, all on one row. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="-mx-1 flex min-w-0 flex-1 flex-wrap gap-1">
          <FilterPill active={kinds.length === 0} onClick={() => setKinds([])} label="All" count={all.length} />
          {ALL_KINDS.map((kind) => {
            const count = kindCounts.get(kind) ?? 0;
            const active = kinds.includes(kind);
            if (count === 0 && !active) return null;
            const meta = KIND_META[kind];
            return (
              <FilterPill
                key={kind}
                active={active}
                onClick={() => setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]))}
                icon={<meta.icon className={cn("size-3", !active && meta.color)} />}
                label={meta.label}
                count={count}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or chat…"
              className="h-8 rounded-lg bg-background pl-8 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" aria-label="Sort">
                <ArrowDownUpIcon className="size-3.5" />
                <span className="hidden sm:inline">{SORTS[sort]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
              {(Object.keys(SORTS) as Sort[]).map((key) => (
                <DropdownMenuItem key={key} className={menuItemClass} onSelect={() => setSort(key)}>
                  <span className="flex-1">{SORTS[key]}</span>
                  {sort === key && <span className="size-1.5 rounded-full bg-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {missing.length > 0 && (
          <motion.div
            key="missing"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              <span className="flex-1">
                {missing.length === 1 ? "1 file is" : `${missing.length} files are`} no longer on disk — moved or
                deleted outside Mali.
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-amber-900 hover:bg-amber-500/15 dark:text-amber-200"
                onClick={() => removeFromList(missing)}
              >
                Remove from list
              </Button>
            </div>
          </motion.div>
        )}
        {notice && (
          <motion.div
            key="notice"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-xs",
              notice.tone === "error" ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-muted text-foreground",
            )}
            role="status"
          >
            <span className="flex-1">{notice.text}</span>
            {notice.undo && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={notice.undo}>
                Undo
              </Button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {outputs.length === 0 ? (
        all.length === 0 ? (
          <div className="min-h-[12rem]">{empty}</div>
        ) : (
          <p className="rounded-2xl bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
            No files match. <button type="button" className="underline" onClick={() => { setSearch(""); setKinds([]); }}>Clear filters</button>
          </p>
        )
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-muted/40">
          <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border/50 px-4 text-xs text-muted-foreground">
            <Checkbox
              checked={allSelected ? true : selecting ? "indeterminate" : false}
              onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(outputs.map((o) => o.path)))}
              aria-label={allSelected ? "Select none" : "Select all"}
              className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background data-[state=indeterminate]:border-foreground data-[state=indeterminate]:bg-foreground data-[state=indeterminate]:text-background"
            >
              <CheckboxIndicator className="size-3" />
            </Checkbox>
            <span>
              {selecting
                ? `${selectedItems.length} of ${outputs.length} selected`
                : `${outputs.length} ${outputs.length === 1 ? "file" : "files"}`}
            </span>
          </div>
          <VirtualList
            items={outputs}
            itemHeight={ITEM_HEIGHT}
            className="flex-1 px-1.5 pb-1.5"
            renderItem={(output) => (
              <OutputRow
                output={output}
                stat={stats.get(output.path)}
                selected={selected.has(output.path)}
                selecting={selecting}
                onToggle={() => toggle(output.path)}
                actions={actions}
              />
            )}
          />

          {/* Bulk actions ride up from the bottom while something is selected. */}
          <AnimatePresence>
            {selecting && (
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-xl border bg-popover px-3 py-2 shadow-lg"
              >
                <span className="flex-1 text-sm font-medium">
                  {selectedItems.length} selected
                </span>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => removeFromList(selectedItems)}>
                  <EyeOffIcon className="size-3.5" />
                  Remove from list
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setConfirmTrash(selectedItems)}
                >
                  <Trash2Icon className="size-3.5" />
                  Move to {TRASH}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear selection"
                  title="Clear selection (Esc)"
                  onClick={() => setSelected(new Set())}
                >
                  <XIcon />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <Dialog open={confirmTrash !== null} onOpenChange={(openState) => !openState && !trashing && setConfirmTrash(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Move {confirmTrash?.length === 1 ? `“${confirmTrash[0].name}”` : `${confirmTrash?.length ?? 0} files`} to the{" "}
              {TRASH}?
            </DialogTitle>
            <DialogDescription>
              {confirmTrash?.length === 1 ? "The file leaves" : "The files leave"} its folder and this list. You can put{" "}
              {confirmTrash?.length === 1 ? "it" : "them"} back from the {TRASH}. The chat that made{" "}
              {confirmTrash?.length === 1 ? "it" : "them"} stays.
            </DialogDescription>
          </DialogHeader>
          {confirmTrash && confirmTrash.length > 1 && (
            <ul className="max-h-40 overflow-y-auto rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {confirmTrash.slice(0, 20).map((o) => (
                <li key={o.path} className="truncate py-0.5" title={o.path}>
                  {o.name}
                </li>
              ))}
              {confirmTrash.length > 20 && <li className="py-0.5">and {confirmTrash.length - 20} more…</li>}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmTrash(null)} disabled={trashing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirmTrash && void moveToTrash(confirmTrash)} disabled={trashing}>
              {trashing ? "Moving…" : `Move to ${TRASH}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FilePreviewDialog
        checkpointId={previewing?.checkpointId ?? ""}
        change={previewChange}
        onOpenChange={() => setPreviewing(null)}
      />
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
      <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-background/20" : "bg-muted")}>
        {count}
      </span>
    </button>
  );
}

type RowActions = Record<
  "preview" | "open" | "reveal" | "copyPath" | "openChat" | "remove" | "trash",
  (output: OutputItem) => void
>;

function OutputRow({
  output,
  stat,
  selected,
  selecting,
  onToggle,
  actions,
}: {
  output: OutputItem;
  stat?: OutputStat;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  actions: RowActions;
}) {
  const meta = KIND_META[output.kind];
  const Icon = meta.icon;
  const project = output.projectId ? getProject(output.projectId) : undefined;
  const missing = stat?.exists === false;
  const size = stat?.size ?? output.size;

  return (
    <div
      role="button"
      tabIndex={0}
      // While selecting, a click adds to the selection; otherwise it previews.
      onClick={() => (selecting ? onToggle() : actions.preview(output))}
      onDoubleClick={() => !selecting && !missing && actions.open(output)}
      onKeyDown={(event) => {
        if (event.key === "Enter") actions.preview(output);
        if (event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "group/output mt-1.5 flex h-[62px] cursor-default items-center gap-3 rounded-xl px-3 outline-none transition-colors",
        "hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring/40",
        selected && "bg-background shadow-sm",
      )}
    >
      {/* The icon turns into a checkbox on hover, and stays one while selecting. */}
      <span className="relative flex size-9 shrink-0 items-center justify-center">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg bg-background transition-opacity",
            meta.color,
            missing && "opacity-50",
            (selecting || selected) && "opacity-0",
            "group-hover/output:opacity-0",
          )}
        >
          <Icon className="size-4" />
        </span>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${output.name}`}
          className={cn(
            "absolute flex size-4 items-center justify-center rounded border border-border bg-background transition-opacity",
            "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background",
            selecting || selected ? "opacity-100" : "opacity-0 group-hover/output:opacity-100 focus-visible:opacity-100",
          )}
        >
          <CheckboxIndicator className="size-3" />
        </Checkbox>
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-sm font-medium", missing && "text-muted-foreground")} title={output.path}>
            {output.name}
          </span>
          {missing && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Missing
            </span>
          )}
          {output.undone && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Undone
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {folderOf(output) && (
            <span className="inline-flex max-w-40 shrink-0 items-center gap-1 truncate" title={output.path}>
              <FolderOpenIcon className="size-3 shrink-0" />
              {folderOf(output)}
            </span>
          )}
          {size != null && !missing && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">{formatSize(size)}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="shrink-0">{formatWhen(output.createdAt)}</span>
          {project && (
            <>
              <span aria-hidden>·</span>
              <span className="max-w-32 truncate" title={project.name}>
                {project.name}
              </span>
            </>
          )}
          {output.chatTitle && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="min-w-0 truncate hover:text-foreground hover:underline"
                title={`Open the chat “${output.chatTitle}”`}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.openChat(output);
                }}
              >
                {output.chatTitle}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-0.5"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {!missing && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Preview"
              aria-label="Preview"
              className="text-muted-foreground opacity-0 transition-opacity group-hover/output:opacity-100 focus-visible:opacity-100"
              onClick={() => actions.preview(output)}
            >
              <EyeIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Open in its app"
              aria-label="Open in its app"
              className="text-muted-foreground opacity-0 transition-opacity group-hover/output:opacity-100 focus-visible:opacity-100"
              onClick={() => actions.open(output)}
            >
              <SquareArrowOutUpRightIcon className="size-4" />
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
            {!missing && (
              <>
                <DropdownMenuItem className={menuItemClass} onSelect={() => actions.preview(output)}>
                  <EyeIcon className="size-4" /> Preview
                </DropdownMenuItem>
                <DropdownMenuItem className={menuItemClass} onSelect={() => actions.open(output)}>
                  <SquareArrowOutUpRightIcon className="size-4" /> Open in its app
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem className={menuItemClass} onSelect={() => actions.reveal(output)}>
              <FolderOpenIcon className="size-4" /> {REVEAL}
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onSelect={() => actions.copyPath(output)}>
              <CopyIcon className="size-4" /> Copy path
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onSelect={() => actions.openChat(output)}>
              <MessageCircleIcon className="size-4" /> Open chat
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border" />
            <DropdownMenuItem className={menuItemClass} onSelect={() => actions.remove(output)}>
              <EyeOffIcon className="size-4" /> Remove from list
            </DropdownMenuItem>
            {!missing && (
              <DropdownMenuItem
                className={cn(menuItemClass, "text-destructive data-[highlighted]:bg-destructive/10")}
                onSelect={() => actions.trash(output)}
              >
                <Trash2Icon className="size-4" /> Move to {TRASH}…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
