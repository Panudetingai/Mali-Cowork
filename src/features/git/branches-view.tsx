import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloudIcon, GitBranchIcon, GitBranchPlusIcon, LoaderIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { gitApi } from "./api";
import { useGit } from "./git-context";
import { timeAgo } from "./parts";
import type { GitBranch } from "./types";

/** Local branches first, then remote ones without a local copy. */
export function BranchesView() {
  const { folder, version, busy, act, changes } = useGit();
  const [branches, setBranches] = useState<GitBranch[]>();
  const [error, setError] = useState<string>();
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    gitApi
      .branches(folder)
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        setError(undefined);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [folder, version]);

  const match = (b: GitBranch) => b.name.toLowerCase().includes(filter.trim().toLowerCase());
  const local = useMemo(() => (branches ?? []).filter((b) => !b.remote), [branches]);
  const remote = useMemo(() => {
    const tracked = new Set(local.map((b) => b.upstream).filter(Boolean));
    return (branches ?? []).filter((b) => b.remote && !tracked.has(b.name));
  }, [branches, local]);

  const create = () => {
    const branch = name.trim();
    if (!branch) return;
    void act(`Creating ${branch}…`, async () => {
      await gitApi.createBranch(folder, branch);
      setName("");
      return `Switched to a new branch ${branch}`;
    });
  };
  const switchTo = (branch: GitBranch) =>
    void act(`Switching to ${branch.name}…`, async () => {
      await gitApi.switchBranch(folder, branch.name, branch.remote);
      return `Switched to ${branch.remote ? branch.name.split("/").slice(1).join("/") : branch.name}`;
    });

  if (error) return <p className="whitespace-pre-wrap p-4 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!branches) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <LoaderIcon className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <form
          className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1 focus-within:border-foreground/30"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <GitBranchPlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))}
            placeholder="New branch from here"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <Button type="submit" size="sm" className="h-6 text-xs" disabled={!name.trim() || !!busy}>
            Create
          </Button>
        </form>
        {branches.length > 8 && (
          <label className="flex items-center gap-2 px-1">
            <SearchIcon className="size-3.5 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter branches"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </label>
        )}
        {changes.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Uncommitted changes come along when you switch, unless they clash with the other branch.
          </p>
        )}
      </div>

      <GroupTitle label="Local" count={local.length} />
      <ul>
        {local.filter(match).map((b) => (
          <BranchRow key={b.name} branch={b} busy={!!busy} onSwitch={() => switchTo(b)} />
        ))}
      </ul>
      {remote.length > 0 && (
        <>
          <GroupTitle label="Remote" count={remote.length} />
          <ul>
            {remote.filter(match).map((b) => (
              <BranchRow key={b.name} branch={b} busy={!!busy} onSwitch={() => switchTo(b)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GroupTitle({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
      {label}
      <span className="tabular-nums">{count}</span>
    </h3>
  );
}

function BranchRow({ branch, busy, onSwitch }: { branch: GitBranch; busy: boolean; onSwitch: () => void }) {
  const Icon = branch.current ? CheckIcon : branch.remote ? CloudIcon : GitBranchIcon;
  return (
    <li className="group/branch flex items-center gap-3 border-b px-4 py-2.5 hover:bg-muted/40">
      <Icon className={cn("size-4 shrink-0", branch.current ? "text-emerald-500" : "text-muted-foreground")} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-[14px]", branch.current && "font-medium")}>{branch.name}</span>
          {branch.current && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              Current
            </span>
          )}
          {branch.ahead > 0 && (
            <span className="flex shrink-0 items-center text-[11px] text-muted-foreground" title={`${branch.ahead} to push`}>
              <ArrowUpIcon className="size-3" />
              {branch.ahead}
            </span>
          )}
          {branch.behind > 0 && (
            <span className="flex shrink-0 items-center text-[11px] text-muted-foreground" title={`${branch.behind} to pull`}>
              <ArrowDownIcon className="size-3" />
              {branch.behind}
            </span>
          )}
          {branch.gone && <span className="shrink-0 text-[11px] text-muted-foreground">remote deleted</span>}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {branch.subject} · {timeAgo(branch.date, true)}
        </span>
      </div>
      {!branch.current && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 text-xs opacity-0 transition-opacity group-hover/branch:opacity-100 focus-visible:opacity-100"
          disabled={busy}
          onClick={onSwitch}
        >
          {branch.remote ? "Check out" : "Switch"}
        </Button>
      )}
    </li>
  );
}
