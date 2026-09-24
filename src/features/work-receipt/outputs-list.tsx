"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VirtualList } from "@/components/ui/virtual-list";
import { FilePreviewDialog, openCheckpointFile, type FileChange } from "@/features/checkpoints";
import { useChatSessions } from "@/features/chat-history";
import { getProject } from "@/features/projects";
import { cn } from "@/lib/utils";
import {
  CodeIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  ImageIcon,
  MessageCircleIcon,
  PresentationIcon,
  SearchIcon,
  Table2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listOutputs } from "./outputs";
import { statOutputs } from "./api";
import type { OutputItem, OutputKind, OutputStat, OutputsQuery } from "./types";

type Props = {
  /** Base filters, e.g. { projectId: ... } for a project tab. */
  query?: OutputsQuery;
  /** Shown when the list is empty. */
  empty: React.ReactNode;
  className?: string;
};

const ITEM_HEIGHT = 72;

const KIND_META: Record<
  OutputKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  document: { label: "Document", icon: FileTextIcon, color: "text-sky-600 dark:text-sky-400" },
  sheet: { label: "Sheet", icon: Table2Icon, color: "text-emerald-600 dark:text-emerald-400" },
  slides: { label: "Slides", icon: PresentationIcon, color: "text-violet-600 dark:text-violet-400" },
  pdf: { label: "PDF", icon: FileTextIcon, color: "text-red-600 dark:text-red-400" },
  image: { label: "Image", icon: ImageIcon, color: "text-amber-600 dark:text-amber-400" },
  code: { label: "Code", icon: CodeIcon, color: "text-indigo-600 dark:text-indigo-400" },
  other: { label: "Other", icon: FileIcon, color: "text-muted-foreground" },
};

const ALL_KINDS = Object.keys(KIND_META) as OutputKind[];

function formatWhen(time: number) {
  const date = new Date(time);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function OutputsList({ query = {}, empty, className }: Props) {
  const sessions = useChatSessions();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<OutputItem | null>(null);
  const [search, setSearch] = useState(query.search ?? "");
  const [kinds, setKinds] = useState<OutputKind[]>(query.kinds ?? []);
  const [stats, setStats] = useState<Map<string, OutputStat>>(new Map());
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  // Callers pass `query` inline (or not at all), so it's a new object every
  // render; keyed by its values instead, or the list and the file checks
  // below would rerun on every render.
  const { projectId, since, includeUndone } = query;
  const baseQuery: OutputsQuery = useMemo(
    () => ({ projectId, since, includeUndone }),
    [projectId, since, includeUndone],
  );
  const mergedQuery: OutputsQuery = useMemo(
    () => ({
      ...baseQuery,
      kinds: kinds.length ? kinds : undefined,
      search: search.trim() || undefined,
    }),
    [baseQuery, kinds, search],
  );

  const outputs = useMemo(() => listOutputs(sessions, mergedQuery), [sessions, mergedQuery]);

  const kindCounts = useMemo(() => {
    const counts = new Map<OutputKind, number>();
    for (const kind of ALL_KINDS) counts.set(kind, 0);
    // Count without search/kind filters, but keep project filter.
    for (const output of listOutputs(sessions, baseQuery)) {
      counts.set(output.kind, (counts.get(output.kind) ?? 0) + 1);
    }
    return counts;
  }, [sessions, baseQuery]);

  // Each file is checked once per visit; scrolling back doesn't ask again.
  const checked = useRef(new Set<string>());

  useEffect(() => {
    const visible = outputs
      .slice(visibleRange.start, visibleRange.end)
      .filter((o) => !checked.current.has(o.path));
    if (!visible.length) return;
    const timer = setTimeout(() => {
      for (const o of visible) checked.current.add(o.path);
      statOutputs(visible).then((results: OutputStat[]) => {
        setStats((prev) => {
          const next = new Map(prev);
          for (const result of results) next.set(result.path, result);
          return next;
        });
      }).catch((error) => {
        // Try these again on the next scroll.
        for (const o of visible) checked.current.delete(o.path);
        console.warn("[outputs] couldn't check files:", error);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [outputs, visibleRange]);

  const toggleKind = (kind: OutputKind) => {
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  };

  const clearKinds = () => setKinds([]);

  const fileChange: FileChange | undefined = selected
    ? {
        path: selected.path,
        relative: selected.relative,
        kind: "added",
        size: selected.size,
        restorable: true,
      }
    : undefined;

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={clearKinds}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              kinds.length === 0
                ? "border-foreground/20 bg-foreground/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            All ({outputs.length})
          </button>
          {ALL_KINDS.map((kind) => {
            const meta = KIND_META[kind];
            const count = kindCounts.get(kind) ?? 0;
            const active = kinds.includes(kind);
            if (count === 0 && !active) return null;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-foreground/20 bg-foreground/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <meta.icon className={cn("size-3", meta.color)} />
                {meta.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search outputs…"
            className="h-8 rounded-lg bg-background pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>

      {outputs.length === 0 ? (
        <div className="min-h-[12rem]">{empty}</div>
      ) : (
        <VirtualList
          items={outputs}
          itemHeight={ITEM_HEIGHT}
          className="-mx-1 flex-1 rounded-2xl border border-border/60 bg-card px-1"
          onRangeChange={setVisibleRange}
          renderItem={(output) => {
            const stat = stats.get(output.path);
            const meta = KIND_META[output.kind];
            const Icon = meta.icon;
            const project = output.projectId ? getProject(output.projectId) : undefined;
            return (
              <div className="group/output flex items-center gap-3 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-muted/30">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60", meta.color)}>
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium" title={output.path}>
                      {output.name}
                    </span>
                    {stat?.exists === false && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        ไม่พบไฟล์
                      </span>
                    )}
                    {output.undone && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Undone
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="truncate max-w-[50%]" title={output.relative}>
                      {output.relative}
                    </span>
                    <span>{formatWhen(output.createdAt)}</span>
                    {project && <span className="truncate max-w-[8rem]" title={project.name}>{project.name}</span>}
                    <span className="truncate max-w-[8rem]" title={output.chatTitle}>{output.chatTitle}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/output:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Preview"
                    aria-label="Preview"
                    onClick={() => setSelected(output)}
                  >
                    <FileTextIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title={/Mac/i.test(navigator.userAgent) ? "Show in Finder" : "Show in folder"}
                    aria-label="Reveal in folder"
                    onClick={() => openCheckpointFile(output.checkpointId, output.path, true).catch(console.error)}
                  >
                    <FolderOpenIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Open chat"
                    aria-label="Open chat"
                    onClick={() => navigate(`/chat/${output.chatId}`)}
                  >
                    <MessageCircleIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          }}
        />
      )}

      <FilePreviewDialog
        checkpointId={selected?.checkpointId ?? ""}
        change={fileChange}
        onOpenChange={() => setSelected(null)}
      />
    </div>
  );
}
