import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { cn } from "@/lib/utils";
import {
    ArrowDownIcon,
    ArrowRightIcon,
    ArrowUpIcon,
    CheckIcon,
    CopyIcon,
    GitBranchIcon,
    LoaderIcon,
    Maximize2Icon,
    Minimize2Icon,
    MoreHorizontalIcon,
    PanelRightCloseIcon,
    RefreshCwIcon,
} from "lucide-react";
import { DiffWrapContext } from "@/components/diff/code-diff";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { gitApi } from "./api";
import { BranchesView } from "./branches-view";
import { ChangesView as ChangesTab, menuClass, menuItemClass } from "./changes-view";
import { CommitMenu, useSync } from "./commit-menu";
import { CommitsView } from "./commits-view";
import { useGitRepo, type GitTab } from "./git-context";
import type { ChangedFile, GitCommit, GitStatus } from "./types";

/**
 * The Git side panel, shown only for folders inside a repository.
 * `embedded` fills a column someone else lays out (Code mode's right pane),
 * without its own width, border or window strip.
 */
export function GitPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const git = useGitRepo();
  const [head, setHead] = useState<GitCommit>();
  const [copied, setCopied] = useState(false);
  const folder = git?.folder;
  const version = git?.version;

  // The latest commit is the panel's title, as a pull request's is.
  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    gitApi
      .log(folder, 0, 1)
      .then((list) => !cancelled && setHead(list[0]))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folder, version, git?.status?.branch.commit]);

  if (!git || !git.panel.open || !git.status) return null;
  const { status, changes, panel, setTab, closePanel, toggleWide, busy, agentRunning } = git;
  const branch = status.branch;

  const copyHash = async () => {
    if (!head) return;
    await navigator.clipboard.writeText(head.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
    {/* A narrow window has no room beside the chat: the panel floats over it, and a click off it closes it. */}
    {!embedded && (
      <button
        type="button"
        aria-label="Close Git panel"
        onClick={closePanel}
        className="absolute inset-0 z-10 hidden bg-black/20 max-[860px]:block"
      />
    )}
    <aside
      className={cn(
        "relative z-10 flex h-full max-w-full flex-col overflow-hidden bg-background",
        embedded
          ? "min-h-0 w-full flex-1"
          : cn(
              "shrink-0 border-l transition-[width] duration-200",
              panel.wide ? "w-[clamp(320px,62%,1000px)]" : "w-[clamp(320px,44%,480px)]",
              NARROW,
            ),
      )}
    >
      {/* Top strip: the panel's tab and window controls. */}
      <div className={cn("flex h-11 shrink-0 items-center gap-1 border-b px-2", embedded && "hidden")}>
        <span className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1 text-sm">
          <GitBranchIcon className="size-4 text-emerald-500" />
          Git
        </span>
        {(busy || agentRunning) && (
          <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
            <LoaderIcon className="size-3 animate-spin" />
            {busy ?? "Agent is working…"}
          </span>
        )}
        <div className="ml-auto flex items-center">
          <StripButton label={panel.wide ? "Narrow" : "Widen"} onClick={toggleWide}>
            {panel.wide ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
          </StripButton>
          <StripButton label="Close" onClick={closePanel}>
            <PanelRightCloseIcon className="size-4" />
          </StripButton>
        </div>
      </div>

      {embedded ? (
        <CompactHeader status={status} changes={changes} head={head} copied={copied} onCopy={() => void copyHash()} />
      ) : (
      <header className="flex shrink-0 flex-col gap-3 border-b px-4 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatePill status={status} changes={changes} />
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate text-foreground/80" title={branch.head}>
              {branch.head ?? `detached ${branch.commit ?? ""}`}
            </span>
            {branch.upstream && (
              <>
                <ArrowRightIcon className="size-3.5 shrink-0" />
                <span className="truncate">{branch.upstream}</span>
              </>
            )}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <MoreMenu />
            <CommitMenu variant="panel" />
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate text-[19px] font-medium" title={head?.subject}>
            {head?.subject ?? (branch.commit ? "…" : "No commits yet")}
          </h2>
          {head && (
            <>
              <span className="shrink-0 font-mono text-[15px] text-muted-foreground">#{head.short}</span>
              <button type="button" onClick={() => void copyHash()} title="Copy commit id" className="shrink-0 text-muted-foreground hover:text-foreground">
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </button>
            </>
          )}
        </div>

        <nav className="-mx-1 flex items-center gap-1">
          <TabButton tab="changes" current={panel.tab} onSelect={setTab} label="Changes" count={changes.length} />
          <TabButton tab="commits" current={panel.tab} onSelect={setTab} label="Commits" />
          <TabButton tab="branches" current={panel.tab} onSelect={setTab} label="Branches" />
          <SyncState status={status} />
        </nav>
      </header>
      )}

      {/* One scroll area, so file headers stick to its top. */}
      <DiffWrapContext.Provider value={embedded}>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {panel.tab === "changes" && <ChangesTab />}
          {panel.tab === "commits" && <CommitsView />}
          {panel.tab === "branches" && <BranchesView />}
        </div>
      </DiffWrapContext.Provider>
    </aside>
    </>
  );
}

/** Below this window width the panel floats over the chat, as wide as fits. */
const NARROW =
  "max-[860px]:absolute max-[860px]:inset-y-0 max-[860px]:right-0 max-[860px]:z-20 max-[860px]:w-[min(420px,calc(100%-16px))] max-[860px]:shadow-2xl";


/**
 * The header for a narrow column (Code mode): status and branch on one line,
 * the last commit under it, a full-width commit button, then the tabs as a
 * segmented control.
 */
function CompactHeader({
  status,
  changes,
  head,
  copied,
  onCopy,
}: {
  status: GitStatus;
  changes: ChangedFile[];
  head?: GitCommit;
  copied: boolean;
  onCopy: () => void;
}) {
  const git = useGitRepo();
  if (!git) return null;
  const { panel, setTab, closePanel } = git;
  const branch = status.branch;
  const tabs: { tab: GitTab; label: string; count?: number }[] = [
    { tab: "changes", label: "Changes", count: changes.length },
    { tab: "commits", label: "Commits" },
    { tab: "branches", label: "Branches" },
  ];
  return (
    <header className="flex shrink-0 flex-col gap-3 border-b px-3 pt-3 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        <StatePill status={status} changes={changes} small />
        <span
          className="flex min-w-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80"
          title={branch.upstream ? `${branch.head} → ${branch.upstream}` : branch.head}
        >
          <GitBranchIcon className="size-3 shrink-0 text-emerald-500" />
          <span className="truncate">{branch.head ?? `detached ${branch.commit ?? ""}`}</span>
        </span>
        <SyncState status={status} />
        <div className={cn("ml-auto flex shrink-0 items-center", branch.upstream && (branch.ahead || branch.behind) && "ml-0")}>
          <MoreMenu />
          <StripButton label="Close" onClick={closePanel}>
            <PanelRightCloseIcon className="size-4" />
          </StripButton>
        </div>
      </div>

      {head && (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">Last commit</span>
          <span className="min-w-0 truncate text-foreground/85" title={head.subject}>
            {head.subject}
          </span>
          <button
            type="button"
            onClick={onCopy}
            title="Copy commit id"
            className="flex shrink-0 items-center gap-1 rounded px-1 font-mono text-[11px] hover:bg-muted hover:text-foreground"
          >
            {head.short}
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      )}

      <CommitMenu variant="panel" block />

      <nav className="relative grid grid-cols-3 rounded-lg bg-muted/60 p-0.5" aria-label="Git views">
        {tabs.map(({ tab, label, count }) => {
          const active = panel.tab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setTab(tab)}
              aria-pressed={active}
              className={cn(
                "relative flex h-7 items-center justify-center gap-1.5 rounded-md text-xs transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="git-compact-tab"
                  className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border/60"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative">{label}</span>
              {!!count && <span className="relative tabular-nums text-muted-foreground">{count}</span>}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

/** Like a PR's Open/Merged badge: where the working folder stands. */
function StatePill({ status, changes, small }: { status: GitStatus; changes: ChangedFile[]; small?: boolean }) {
  const { branch } = status;
  const [label, tone] = changes.some((c) => c.kind === "conflicted")
    ? ["Conflicts", "red"]
    : status.operation
      ? [status.operation[0].toUpperCase() + status.operation.slice(1), "amber"]
      : changes.length > 0
        ? ["Uncommitted", "amber"]
        : branch.ahead > 0
          ? ["Unpushed", "sky"]
          : branch.behind > 0
            ? ["Behind", "violet"]
            : !branch.upstream
              ? ["Local", "muted"]
              : ["Up to date", "green"];
  const tones: Record<string, string> = {
    red: "bg-red-500/15 text-red-700 dark:text-red-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full font-medium",
        small ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-[13px]",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

/** ↑2 ↓1 against the upstream, at the end of the tab row. */
function SyncState({ status }: { status: GitStatus }) {
  const { ahead, behind, upstream } = status.branch;
  if (!upstream || (!ahead && !behind)) return null;
  return (
    <span className="ml-auto flex items-center gap-2 pr-1 text-xs text-muted-foreground" title={`Compared with ${upstream}`}>
      {ahead > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowUpIcon className="size-3" />
          {ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowDownIcon className="size-3" />
          {behind}
        </span>
      )}
    </span>
  );
}

function MoreMenu() {
  const git = useGitRepo();
  const sync = useSync();
  if (!git) return null;
  const hasRemote = (git.status?.remotes.length ?? 0) > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <MoreHorizontalIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
        <DropdownMenuItem className={menuItemClass} onSelect={() => void git.refresh()}>
          <RefreshCwIcon className="size-4 text-muted-foreground" />
          Refresh
        </DropdownMenuItem>
        {hasRemote && (
          <DropdownMenuItem className={menuItemClass} onSelect={sync.fetch}>
            <RefreshCwIcon className="size-4 text-muted-foreground" />
            Fetch from remote
          </DropdownMenuItem>
        )}
        {sync.canPull && (
          <DropdownMenuItem className={menuItemClass} onSelect={sync.pull}>
            <ArrowDownIcon className="size-4 text-muted-foreground" />
            Pull
          </DropdownMenuItem>
        )}
        {sync.canPush && (
          <DropdownMenuItem className={menuItemClass} onSelect={sync.push}>
            <ArrowUpIcon className="size-4 text-muted-foreground" />
            {git.status?.branch.upstream ? "Push" : "Publish branch"}
          </DropdownMenuItem>
        )}
        {git.status?.branch.head && (
          <DropdownMenuItem
            className={menuItemClass}
            onSelect={() => void navigator.clipboard.writeText(git.status!.branch.head!)}
          >
            <CopyIcon className="size-4 text-muted-foreground" />
            Copy branch name
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  label,
  count,
}: {
  tab: GitTab;
  current: GitTab;
  onSelect: (tab: GitTab) => void;
  label: string;
  count?: number;
}) {
  const active = tab === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[14px] transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {!!count && <span className="text-muted-foreground tabular-nums">{count}</span>}
    </button>
  );
}

function StripButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
