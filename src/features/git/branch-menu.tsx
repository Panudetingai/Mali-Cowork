import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { Command } from "cmdk";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ArchiveIcon,
  CheckIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { gitApi } from "./api";
import { useSync } from "./commit-menu";
import { useGit, type RemoteOp } from "./git-context";
import { timeAgo } from "./parts";
import type { GitBranch, GitCommit } from "./types";

const RECENT_COMMITS = 5;

/** ⇧⌘G, the way macOS menus spell it. */
const TOGGLE_HINT = "⇧⌘G";

const itemClass =
  "flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40 data-[selected=true]:bg-muted";

const groupClass =
  "px-1.5 py-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

const REMOTE_LABEL: Record<RemoteOp, string> = {
  pull: "Pulling…",
  push: "Pushing…",
  fetch: "Fetching…",
};

/** A short bar sliding along the bottom edge while the remote is busy. */
function ProgressLine({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden", className)}>
      <span className="block h-full w-2/5 animate-[indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-foreground/60 motion-reduce:animate-none" />
    </span>
  );
}

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function AheadPill({ ahead, behind, long, className }: { ahead: number; behind: number; long?: boolean; className?: string }) {
  if (!ahead && !behind) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-2 text-xs tabular-nums", className)}>
      {ahead > 0 && (
        <span className="flex items-center gap-1" title={`${ahead} to push`}>
          <ArrowUpIcon className="size-3" />
          {ahead}
          {long && " ahead"}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center gap-1" title={`${behind} to pull`}>
          <ArrowDownIcon className="size-3" />
          {behind}
          {long && " behind"}
        </span>
      )}
    </span>
  );
}

function Item({
  icon: Icon,
  value,
  onSelect,
  disabled,
  shortcut,
  loading,
  className,
  children,
}: {
  icon: LucideIcon;
  loading?: boolean;
  value: string;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} disabled={disabled} className={cn(itemClass, className)}>
      {loading ? (
        <LoaderIcon className="size-4 shrink-0 animate-spin text-foreground" />
      ) : (
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <Kbd className="h-5 px-1.5 tracking-wider">{shortcut}</Kbd>}
    </Command.Item>
  );
}

/**
 * The branch pill above the composer and its command menu: commit, sync,
 * switch or create a branch, and glance at recent commits — all from the
 * keyboard (⇧⌘G opens it).
 */
export function BranchMenu() {
  const git = useGit();
  const [open, setOpen] = useState(false);
  const { status, remoteBusy } = git;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac() ? event.metaKey : event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  const { branch } = status;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Branch, commit and sync"
          aria-busy={!!remoteBusy}
          className="relative flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-xl border bg-background pr-1.5 pl-2.5 text-[13px] transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60"
        >
          {remoteBusy ? (
            <LoaderIcon className="size-3.5 animate-spin text-foreground" />
          ) : (
            <GitBranchIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className="max-w-44 truncate font-medium">{branch.head ?? branch.commit ?? "No commits"}</span>
          {remoteBusy ? (
            <TextShimmer duration={1.6} className="text-[11px]">
              {REMOTE_LABEL[remoteBusy]}
            </TextShimmer>
          ) : (
            <AheadPill
              ahead={branch.ahead}
              behind={branch.behind}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            />
          )}
          {remoteBusy && <ProgressLine />}
          <Kbd className="hidden h-5 px-1.5 text-[11px] tracking-wider sm:inline-flex">{TOGGLE_HINT}</Kbd>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(26rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-2xl p-0 shadow-xl"
      >
        {open && <MenuBody onClose={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function MenuBody({ onClose }: { onClose: () => void }) {
  const { folder, status, changes, busy, remoteBusy, version, act, confirm, openPanel } = useGit();
  const sync = useSync();
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);

  useEffect(() => {
    let cancelled = false;
    gitApi.branches(folder).then((list) => !cancelled && setBranches(list)).catch(() => undefined);
    gitApi.log(folder, 0, RECENT_COMMITS).then((list) => !cancelled && setCommits(list)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [folder, version]);

  if (!status) return null;
  const { branch } = status;
  const hasRemote = status.remotes.length > 0;
  const staged = changes.filter((c) => c.staged !== false).length;
  const localBranches = branches.filter((b) => !b.remote);
  const canCommit = !!message.trim() && changes.length > 0 && !busy;

  /** Close first, so confirm dialogs and toasts aren't hidden behind the menu. */
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const commit = () => {
    if (!canCommit) return;
    const text = message;
    onClose();
    void act("Committing…", async () => {
      const result = await gitApi.commit(folder, text, staged === 0);
      return `Committed ${result.hash} · ${result.subject}`;
    });
  };

  const stash = run(() => void act("Stashing…", async () => (await gitApi.stash(folder)).message));

  const discardAll = run(() =>
    confirm({
      title: "Discard all changes?",
      description: (
        <>
          Every unstaged edit in <b>{changes.length} file{changes.length === 1 ? "" : "s"}</b> goes back to its last
          committed or staged version, and new files are deleted. This can&apos;t be undone.
        </>
      ),
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () =>
        void act("Discarding…", async () => {
          await gitApi.discard(
            folder,
            changes.map((c) => c.path),
          );
          return "Changes discarded";
        }),
    }),
  );

  const switchTo = (target: GitBranch) =>
    run(
      () =>
        void act(`Switching to ${target.name}…`, async () => {
          await gitApi.switchBranch(folder, target.name, target.remote);
          return `Switched to ${target.name}`;
        }),
    )();

  const createBranch = () => {
    const name = search.trim().replace(/\s+/g, "-");
    if (!name) return;
    run(
      () =>
        void act(`Creating ${name}…`, async () => {
          await gitApi.createBranch(folder, name);
          return `Switched to a new branch ${name}`;
        }),
    )();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = isMac() ? event.metaKey : event.ctrlKey;
    if (!mod || !event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "p" && sync.canPull) {
      event.preventDefault();
      run(sync.pull)();
    } else if (key === "u" && sync.canPush) {
      event.preventDefault();
      run(sync.push)();
    }
  };

  return (
    <Command loop onKeyDown={onKeyDown} shouldFilter={!creating} className="flex flex-col text-popover-foreground">
      <header className="relative flex flex-col gap-1.5 border-b px-4 pt-4 pb-3">
        {remoteBusy && <ProgressLine className="-bottom-px" />}
        <div className="flex items-center gap-2.5">
          <GitBranchIcon className="size-4 shrink-0" />
          <span className="min-w-0 truncate text-base font-semibold tracking-tight">
            {branch.head ?? branch.commit ?? "No commits"}
          </span>
          <AheadPill
            ahead={branch.ahead}
            behind={branch.behind}
            long
            className="rounded-full border px-2.5 py-0.5 font-medium"
          />
          <Kbd className="ml-auto h-6 px-1.5 tracking-wider">{TOGGLE_HINT}</Kbd>
        </div>
        <p className="flex gap-3 text-xs text-muted-foreground">
          {remoteBusy && (
            <TextShimmer duration={1.6} className="text-xs">
              {REMOTE_LABEL[remoteBusy]}
            </TextShimmer>
          )}
          <span>{changes.length} changed</span>
          <span>{staged} staged</span>
          {branch.upstream && <span className="ml-auto truncate">{branch.upstream}</span>}
        </p>
      </header>

      <form
        className="flex items-center gap-2 border-b py-2 pr-2 pl-4"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={changes.length ? "Commit message..." : "Nothing to commit"}
          disabled={!changes.length}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canCommit}
          title={staged ? `Commit ${staged} staged file${staged === 1 ? "" : "s"}` : "Commit all changes"}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:bg-muted-foreground/60 disabled:opacity-100"
        >
          <GitCommitHorizontalIcon className="size-4" />
          Commit
        </button>
      </form>

      <label className="flex items-center gap-2.5 border-b px-4 py-2.5">
        {creating ? (
          <button
            type="button"
            aria-label="Back"
            onClick={() => {
              setCreating(false);
              setSearch("");
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        ) : (
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <Command.Input
          autoFocus
          value={search}
          onValueChange={(value) => setSearch(creating ? value.replace(/\s+/g, "-") : value)}
          onKeyDown={(event) => {
            if (creating && event.key === "Escape") {
              event.preventDefault();
              setCreating(false);
              setSearch("");
            }
          }}
          placeholder={creating ? "New branch name, e.g. feature/login" : "Search branches or actions..."}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>

      <Command.List className="max-h-[min(22rem,50svh)] overflow-y-auto overscroll-contain">
        {creating ? (
          <Command.Group className={groupClass}>
            <Item icon={PlusIcon} value="create" onSelect={createBranch} disabled={!search.trim() || !!busy}>
              {search.trim() ? (
                <>
                  Create <span className="font-medium">{search.trim()}</span> from{" "}
                  <span className="text-muted-foreground">{branch.head ?? "HEAD"}</span>
                </>
              ) : (
                <span className="text-muted-foreground">Type a name for the new branch</span>
              )}
            </Item>
          </Command.Group>
        ) : (
          <>
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</Command.Empty>

            <Command.Group heading="Actions" className={groupClass}>
              <Item
                icon={ArrowDownIcon}
                value="pull from origin"
                onSelect={run(sync.pull)}
                disabled={!sync.canPull || !!busy}
                loading={remoteBusy === "pull"}
                shortcut="⌘⇧P"
              >
                {remoteBusy === "pull" ? REMOTE_LABEL.pull : `Pull from ${branch.upstream?.split("/")[0] ?? "origin"}`}
              </Item>
              <Item
                icon={ArrowUpIcon}
                value="push to origin publish"
                onSelect={run(sync.push)}
                disabled={!sync.canPush || !!busy}
                loading={remoteBusy === "push"}
                shortcut="⌘⇧U"
              >
                {remoteBusy === "push"
                  ? REMOTE_LABEL.push
                  : branch.upstream
                    ? `Push to ${branch.upstream.split("/")[0]}`
                    : "Publish branch"}
              </Item>
              {/* Fetch asks nothing, so the menu stays open and shows it working. */}
              <Item
                icon={RefreshCwIcon}
                value="fetch all remotes"
                onSelect={sync.fetch}
                disabled={!hasRemote || !!busy}
                loading={remoteBusy === "fetch"}
              >
                {remoteBusy === "fetch" ? REMOTE_LABEL.fetch : "Fetch all remotes"}
              </Item>
              <Item icon={ArchiveIcon} value="stash changes" onSelect={stash} disabled={!changes.length || !!busy}>
                Stash changes
              </Item>
              <Item
                icon={RotateCcwIcon}
                value="discard all changes"
                onSelect={discardAll}
                disabled={!changes.length || !!busy}
                className="data-[selected=true]:text-red-600 dark:data-[selected=true]:text-red-400"
              >
                Discard all changes
              </Item>
            </Command.Group>

            <Command.Separator className="h-px bg-border" />

            <Command.Group heading="Branches" className={groupClass}>
              {localBranches.map((b) => (
                <Command.Item
                  key={b.name}
                  value={`branch ${b.name}`}
                  onSelect={() => !b.current && switchTo(b)}
                  disabled={!!busy}
                  className={itemClass}
                >
                  <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className={cn("min-w-0 flex-1 truncate", b.current && "font-medium")}>{b.name}</span>
                  <AheadPill ahead={b.ahead} behind={b.behind} className="rounded-full border px-2 py-px text-muted-foreground" />
                  {b.current && <CheckIcon className="size-4 shrink-0" />}
                </Command.Item>
              ))}
              <Item icon={PlusIcon} value="create new branch" onSelect={() => {
                setCreating(true);
                setSearch("");
              }}>
                Create new branch
              </Item>
            </Command.Group>

            {commits.length > 0 && (
              <>
                <Command.Separator className="h-px bg-border" />
                <Command.Group heading="Recent Commits" className={groupClass}>
                  {commits.map((c) => (
                    <Command.Item
                      key={c.hash}
                      value={`commit ${c.short} ${c.subject} ${c.author}`}
                      onSelect={run(() => openPanel("commits"))}
                      className={cn(itemClass, "items-start")}
                    >
                      <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate">{c.subject}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{c.short}</span> · {c.author} · {timeAgo(c.date)}
                        </span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              </>
            )}
          </>
        )}
      </Command.List>
    </Command>
  );
}
