import { DiffStat } from "@/components/diff/diff-view";
import { Button } from "@/components/ui/button";
import { BranchMenu } from "./branch-menu";
import { CommitMenu } from "./commit-menu";
import { useGitRepo } from "./git-context";

const pill = "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors";

/** Above the composer: branch menu, what changed, and commit — only inside a repository. */
export function GitBar() {
  const git = useGitRepo();
  if (!git?.status) return null;
  const { changes, openPanel } = git;
  const additions = changes.reduce((n, c) => n + (c.additions ?? 0), 0);
  const deletions = changes.reduce((n, c) => n + (c.deletions ?? 0), 0);

  return (
    <div className="flex w-full max-w-3xl flex-wrap items-center gap-2 px-1">
      <BranchMenu />
      {changes.length > 0 && (
        <>
          <Button type="button" variant="outline" className={pill} onClick={() => openPanel("changes")} title="Show the changes">
            <span className="text-muted-foreground">Changes</span>
            <DiffStat additions={additions} deletions={deletions} className="text-[13px]" />
            {!additions && !deletions && <span className="text-muted-foreground tabular-nums">{changes.length}</span>}
          </Button>
          <CommitMenu variant="bar" />
        </>
      )}
    </div>
  );
}
