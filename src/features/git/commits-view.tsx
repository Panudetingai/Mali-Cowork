import { DiffStat } from "@/components/diff/diff-view";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, CheckIcon, CopyIcon, GitCommitHorizontalIcon, LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { gitApi } from "./api";
import { FileDiffList, type DiffFile } from "./file-diff-list";
import { useGit } from "./git-context";
import { RefPill, timeAgo } from "./parts";
import type { GitCommit, GitCommitFile } from "./types";

const PAGE = 50;

/** Commits reachable from HEAD, grouped by day; one opens to its diffs. */
export function CommitsView() {
  const { folder, version } = useGit();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<GitCommit>();

  const load = useCallback(
    async (skip: number) => {
      setLoading(true);
      try {
        const page = await gitApi.log(folder, skip, PAGE);
        setCommits((prev) => (skip === 0 ? page : [...prev, ...page]));
        setDone(page.length < PAGE);
        setError(undefined);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [folder],
  );

  useEffect(() => {
    void load(0);
  }, [load, version]);

  const groups = useMemo(() => groupByDay(commits), [commits]);

  if (selected) return <CommitDetail commit={selected} onBack={() => setSelected(undefined)} />;
  if (error) return <p className="whitespace-pre-wrap p-4 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!loading && commits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <GitCommitHorizontalIcon className="size-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">No commits yet</p>
        <p className="text-xs text-muted-foreground">Commit your changes to start the history.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
            {group.label}
            <span className="tabular-nums">{group.commits.length}</span>
          </h3>
          <ul>
            {group.commits.map((commit) => (
              <li key={commit.hash} className="border-b">
                <button
                  type="button"
                  onClick={() => setSelected(commit)}
                  className="flex w-full min-w-0 flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px]">{commit.subject}</span>
                    <DiffStat additions={commit.additions} deletions={commit.deletions} className="text-[13px]" />
                    {commit.refs.map((ref) => (
                      <RefPill key={ref} name={ref} />
                    ))}
                  </span>
                  <CommitMeta commit={commit} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {loading ? (
        <div className="flex justify-center py-5 text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
        </div>
      ) : (
        !done && (
          <button
            type="button"
            onClick={() => void load(commits.length)}
            className="py-3 text-center text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            Load older commits
          </button>
        )
      )}
    </div>
  );
}

/** "Ann and Cursor Agent · 3 files, 2w ago · cddb327". */
function CommitMeta({ commit, className }: { commit: GitCommit; className?: string }) {
  const people = [
    { name: commit.author, email: commit.email },
    ...commit.coAuthors.filter((c) => c.name !== commit.author),
  ];
  const names = people.map((p) => p.name);
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground", className)}>
      <span className="truncate font-medium text-foreground/80" title={people.map((p) => `${p.name} <${p.email}>`).join("\n")}>
        {names.length > 2 ? `${names[0]} and ${names.length - 1} others` : names.join(" and ")}
      </span>
      <span className="shrink-0">
        {commit.files} {commit.files === 1 ? "file" : "files"},{" "}
        <span title={new Date(commit.date * 1000).toLocaleString()}>{timeAgo(commit.date, true)}</span>
      </span>
      <span className="shrink-0 font-mono text-muted-foreground/70">{commit.short}</span>
    </span>
  );
}

function CommitDetail({ commit, onBack }: { commit: GitCommit; onBack: () => void }) {
  const { folder } = useGit();
  const [files, setFiles] = useState<GitCommitFile[]>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gitApi
      .commitFiles(folder, commit.hash)
      .then((f) => !cancelled && setFiles(f))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [folder, commit.hash]);

  const loadDiff = useCallback(
    (file: DiffFile) =>
      gitApi.diff(folder, { kind: "commit", hash: commit.hash, path: file.path, origPath: file.origPath, status: "M" }),
    [folder, commit.hash],
  );

  const copy = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All commits
        </button>
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] font-medium">{commit.subject}</h3>
          <button type="button" onClick={() => void copy()} title="Copy commit id" className="mt-0.5 text-muted-foreground hover:text-foreground">
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          </button>
        </div>
        {commit.body && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{commit.body}</p>}
        <CommitMeta commit={commit} />
      </div>
      {error ? (
        <p className="whitespace-pre-wrap p-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !files ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
        </div>
      ) : (
        <FileDiffList
          files={files.map((f) => ({
            key: f.path,
            path: f.path,
            origPath: f.origPath,
            kind: f.status === "A" ? "added" : f.status === "D" ? "deleted" : f.status === "R" || f.status === "C" ? "renamed" : "modified",
            additions: f.additions,
            deletions: f.deletions,
          }))}
          loadDiff={loadDiff}
          reloadKey={commit.hash}
        />
      )}
    </div>
  );
}

function groupByDay(commits: GitCommit[]) {
  const thisYear = new Date().getFullYear();
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  const dayYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
  const groups: { label: string; commits: GitCommit[] }[] = [];
  for (const commit of commits) {
    const date = new Date(commit.date * 1000);
    const label = (date.getFullYear() === thisYear ? day : dayYear).format(date);
    const last = groups.at(-1);
    if (last?.label === label) last.commits.push(commit);
    else groups.push({ label, commits: [commit] });
  }
  return groups;
}
