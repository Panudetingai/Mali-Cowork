import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    ChevronDownIcon,
    GitBranchPlusIcon,
    GitCommitHorizontalIcon,
    LoaderIcon,
    RefreshCwIcon,
    SparklesIcon,
    UploadCloudIcon,
} from "lucide-react";
import { useState } from "react";
import { gitApi } from "./api";
import { menuClass, menuItemClass } from "./changes-view";
import { writeCommitMessage } from "./commit-message";
import { useGit } from "./git-context";

type Mode = "commit" | "commit-push" | "branch-commit";

const LABEL: Record<Mode, string> = {
  commit: "Commit",
  "commit-push": "Commit & Push",
  "branch-commit": "Create Branch & Commit",
};

/** Unsent commit messages, per folder, kept while the app runs. */
const drafts = new Map<string, string>();

/** Pull and push, each confirmed first: both talk to the remote. */
export function useSync() {
  const { folder, status, act, confirm } = useGit();
  const branch = status?.branch;
  const code = (text?: string) => <code className="rounded bg-muted px-1 text-foreground">{text}</code>;
  return {
    // Only when the remote has commits this branch lacks (known after a fetch).
    canPull: !!branch?.upstream && branch.behind > 0,
    canPush: !!branch?.head && !!branch.commit && (status?.remotes.length ?? 0) > 0 && (!branch.upstream || branch.ahead > 0),
    pull: () =>
      confirm({
        title: "Pull from the remote?",
        description: (
          <>
            Bring {branch?.behind ? <b>{branch.behind} new commit{branch.behind > 1 ? "s" : ""}</b> : "any new commits"} from{" "}
            {code(branch?.upstream)} into {code(branch?.head)}. Fast-forward only: nothing is merged for you.
          </>
        ),
        confirmLabel: "Pull",
        onConfirm: () => void act("Pulling…", async () => (await gitApi.pull(folder)).message),
      }),
    push: () =>
      confirm({
        title: branch?.upstream ? "Push your commits?" : "Publish this branch?",
        description: branch?.upstream ? (
          <>
            Send <b>{branch.ahead} commit{branch.ahead === 1 ? "" : "s"}</b> from {code(branch.head)} to {code(branch.upstream)}.
            Anyone with access to the remote will see them.
          </>
        ) : (
          <>
            Create {code(branch?.head)} on the remote with this branch&apos;s commits. Anyone with access to the remote will see
            them.
          </>
        ),
        confirmLabel: branch?.upstream ? "Push" : "Publish",
        onConfirm: () => void act("Pushing…", async () => (await gitApi.push(folder)).message),
      }),
    fetch: () => void act("Fetching…", async () => (await gitApi.fetch(folder)).message),
  };
}

/**
 * The main commit button, split like a merge button: the primary action,
 * and a menu with the others. Every commit opens a small form first.
 */
export function CommitMenu({ variant }: { variant: "panel" | "bar" }) {
  const { status, changes, busy } = useGit();
  const sync = useSync();
  const [mode, setMode] = useState<Mode>();
  const hasRemote = (status?.remotes.length ?? 0) > 0;
  const onDefaultBranch = ["main", "master"].includes(status?.branch.head ?? "");
  const primary: Mode = onDefaultBranch && hasRemote ? "branch-commit" : "commit";
  const nothing = changes.length === 0;

  const bar = variant === "bar";
  const shape = bar
    ? "h-8 border bg-background text-foreground hover:bg-muted"
    : "h-8 bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500/90 dark:text-emerald-950 dark:hover:bg-emerald-400";

  return (
    <Popover open={!!mode} onOpenChange={(open) => !open && setMode(undefined)}>
      <PopoverAnchor asChild>
        <div className={cn("flex shrink-0 items-stretch overflow-hidden rounded-full", bar && "shadow-sm")}>
          <button
            type="button"
            disabled={nothing || !!busy}
            onClick={() => setMode(primary)}
            className={cn("flex items-center gap-1.5 pr-2.5 pl-3.5 text-[13px] font-medium transition-colors disabled:opacity-50", shape, bar && "rounded-l-full border-r-0")}
          >
            {LABEL[primary]}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More git actions"
                disabled={!!busy}
                className={cn(
                  "flex items-center border-l px-2 transition-colors disabled:opacity-50",
                  shape,
                  bar ? "rounded-r-full" : "border-emerald-700/40 dark:border-emerald-950/30",
                )}
              >
                <ChevronDownIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side={bar ? "top" : "bottom"} sideOffset={6} className={cn(menuClass, "w-60")}>
              <DropdownMenuItem className={menuItemClass} disabled={nothing} onSelect={() => setMode("commit")}>
                <GitCommitHorizontalIcon className="size-4 text-muted-foreground" />
                Commit
              </DropdownMenuItem>
              {hasRemote && (
                <DropdownMenuItem className={menuItemClass} disabled={nothing} onSelect={() => setMode("commit-push")}>
                  <UploadCloudIcon className="size-4 text-muted-foreground" />
                  Commit & Push
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className={menuItemClass} disabled={nothing} onSelect={() => setMode("branch-commit")}>
                <GitBranchPlusIcon className="size-4 text-muted-foreground" />
                Create Branch & Commit
              </DropdownMenuItem>
              {hasRemote && <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />}
              {sync.canPull && (
                <DropdownMenuItem className={menuItemClass} onSelect={sync.pull}>
                  <ArrowDownIcon className="size-4 text-muted-foreground" />
                  Pull
                  <span className="ml-auto text-xs text-muted-foreground">{status?.branch.behind}</span>
                </DropdownMenuItem>
              )}
              {sync.canPush && (
                <DropdownMenuItem className={menuItemClass} onSelect={sync.push}>
                  <ArrowUpIcon className="size-4 text-muted-foreground" />
                  {status?.branch.upstream ? "Push" : "Publish branch"}
                  {!!status?.branch.ahead && <span className="ml-auto text-xs text-muted-foreground">{status.branch.ahead}</span>}
                </DropdownMenuItem>
              )}
              {hasRemote && (
                <DropdownMenuItem className={menuItemClass} onSelect={sync.fetch}>
                  <RefreshCwIcon className="size-4 text-muted-foreground" />
                  Fetch
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" side={bar ? "top" : "bottom"} sideOffset={8} className="w-[22rem] gap-3 p-3">
        {mode && <CommitForm mode={mode} onDone={() => setMode(undefined)} />}
      </PopoverContent>
    </Popover>
  );
}

function CommitForm({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const { folder, status, changes, busy, act } = useGit();
  const [message, setMessageState] = useState(() => drafts.get(folder) ?? "");
  const [branch, setBranch] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  const [push, setPush] = useState(mode === "commit-push");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string>();

  const hasRemote = (status?.remotes.length ?? 0) > 0;
  const staged = changes.filter((c) => c.staged !== false).length;
  const stageAll = staged === 0;
  const newBranch = mode === "branch-commit";
  const branchName = branchEdited ? branch : suggestBranch(message);
  const ready = !!message.trim() && (!newBranch || !!branchName.trim()) && !busy && !writing;

  const setMessage = (text: string) => {
    drafts.set(folder, text);
    setMessageState(text);
  };

  const write = async () => {
    setWriting(true);
    setError(undefined);
    try {
      setMessage(await writeCommitMessage(folder));
    } catch (e) {
      setError(String(e));
    } finally {
      setWriting(false);
    }
  };

  const submit = () => {
    if (!ready) return;
    const target = branchName.trim();
    onDone();
    void act(newBranch ? `Creating ${target} and committing…` : "Committing…", async () => {
      if (newBranch) await gitApi.createBranch(folder, target);
      const result = await gitApi.commit(folder, message, stageAll);
      drafts.delete(folder);
      if (push) {
        const pushed = await gitApi.push(folder);
        return `Committed ${result.hash} · ${pushed.message}`;
      }
      return `Committed ${result.hash} · ${result.subject}`;
    });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm font-medium">{LABEL[mode]}</p>
      {newBranch && (
        <label className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5">
          <GitBranchPlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={branchName}
            onChange={(e) => {
              setBranchEdited(true);
              setBranch(e.target.value.replace(/\s+/g, "-"));
            }}
            placeholder="feature/my-change"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      )}
      <div className="rounded-lg border bg-muted/30 focus-within:border-foreground/30">
        <textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={4}
          placeholder="Describe your changes"
          className="w-full resize-none bg-transparent px-2.5 pt-2 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center px-1.5 pb-1.5">
          <button
            type="button"
            onClick={() => void write()}
            disabled={writing}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
            title="Write it with the model picked for Chat"
          >
            {writing ? <LoaderIcon className="size-3.5 animate-spin" /> : <SparklesIcon className="size-3.5" />}
            Write with AI
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {stageAll ? `Commits all ${changes.length} changed files.` : `Commits the ${staged} staged file${staged === 1 ? "" : "s"}.`}
      </p>
      {hasRemote && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="accent-emerald-600" />
          Push to {status?.branch.upstream && !newBranch ? status.branch.upstream : "the remote"} afterwards
        </label>
      )}
      {error && <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready} className="bg-emerald-600 text-white hover:bg-emerald-500">
          {newBranch ? "Create & Commit" : push ? "Commit & Push" : "Commit"}
        </Button>
      </div>
    </form>
  );
}

/** `feature/add-login-page` from the message's first line. */
function suggestBranch(message: string) {
  const slug = message
    .split("\n")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `feature/${slug || `update-${new Date().toISOString().slice(0, 10)}`}`;
}
