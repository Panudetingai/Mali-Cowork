import { DiffStat } from "@/components/diff/diff-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon, GitBranchIcon } from "lucide-react";
import { CommitMenu, useSync } from "./commit-menu";
import { useGitRepo } from "./git-context";

const pill = "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors";

/** Above the composer: what changed, commit, and sync — only inside a repository. */
export function GitBar() {
  const git = useGitRepo();
  const sync = useSync();
  if (!git?.status) return null;
  const { changes, status, openPanel } = git;
  const { branch } = status;
  const additions = changes.reduce((n, c) => n + (c.additions ?? 0), 0);
  const deletions = changes.reduce((n, c) => n + (c.deletions ?? 0), 0);

  return (
    <div className="flex w-full max-w-3xl flex-wrap items-center gap-2 px-1">
      {changes.length > 0 ? (
        <Button type="button" variant="outline" className={pill} onClick={() => openPanel("changes")} title="Show the changes">
          <span className="text-muted-foreground">Changes</span>
          <DiffStat additions={additions} deletions={deletions} className="text-[13px]" />
          {!additions && !deletions && <span className="text-muted-foreground tabular-nums">{changes.length}</span>}
        </Button>
      ) : (
        <Button type="button" variant="outline" className={pill} onClick={() => openPanel("commits")} title="Open Git">
          <GitBranchIcon className="size-3.5 text-muted-foreground" />
          <span className="max-w-40 truncate text-muted-foreground">{branch.head ?? branch.commit}</span>
        </Button>
      )}
      {changes.length > 0 && <CommitMenu variant="bar" />}
      {sync.canPull && (
        <RoundButton label={`Pull ${branch.behind} new commit${branch.behind === 1 ? "" : "s"}`} onClick={sync.pull}>
          <ArrowDownIcon className="size-4" />
          <span className="text-[11px] tabular-nums">{branch.behind}</span>
        </RoundButton>
      )}
      {sync.canPush && branch.ahead > 0 && (
        <RoundButton label={`Push ${branch.ahead} commits`} onClick={sync.push}>
          <ArrowUpIcon className="size-4" />
          <span className="text-[11px] tabular-nums">{branch.ahead}</span>
        </RoundButton>
      )}
    </div>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(pill, "min-w-8 justify-center gap-0.5 px-2 text-muted-foreground hover:text-foreground")}
    >
      {children}
    </button>
  );
}
