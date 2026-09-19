export type GitBranchState = {
  /** Branch name; undefined when HEAD is detached. */
  head?: string;
  /** Short id of HEAD; undefined before the first commit. */
  commit?: string;
  upstream?: string;
  ahead: number;
  behind: number;
};

export type GitStatusFile = {
  /** Relative to the repository root, with `/`. */
  path: string;
  origPath?: string;
  /** `M`, `A`, `D`, `R`, `C`, `T` when staged. */
  staged?: string;
  /** Change not yet staged; `?` for untracked, `U` for conflicts. */
  unstaged?: string;
  untracked: boolean;
  conflicted: boolean;
};

export type GitStatus = {
  isRepo: boolean;
  root?: string;
  branch: GitBranchState;
  files: GitStatusFile[];
  truncated: boolean;
  operation?: "merge" | "rebase" | "cherry-pick" | "revert";
  remotes: string[];
};

export type GitPerson = { name: string; email: string };

export type GitCommit = {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  /** Seconds since the Unix epoch. */
  date: number;
  refs: string[];
  subject: string;
  body: string;
  /** People from `Co-authored-by:` trailers. */
  coAuthors: GitPerson[];
  files: number;
  additions: number;
  deletions: number;
};

export type GitCommitFile = {
  path: string;
  origPath?: string;
  status: string;
  additions?: number;
  deletions?: number;
};

/** A changed file in the working folder, with line counts against HEAD. */
export type ChangedFile = {
  path: string;
  origPath?: string;
  kind: "added" | "modified" | "deleted" | "renamed" | "conflicted";
  /** Whole change staged (`true`), none (`false`), or part (`null`). */
  staged: boolean | null;
  untracked: boolean;
  additions?: number;
  deletions?: number;
};

export type GitBranch = {
  name: string;
  remote: boolean;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  gone: boolean;
  date: number;
  subject: string;
};

export type CommitContext = {
  diff: string;
  recentSubjects: string[];
  allChanges: boolean;
};

/** Which diff of a file to show. */
export type DiffTarget =
  | { kind: "worktree"; path: string; origPath?: string; area: "staged" | "unstaged" | "untracked" | "head" }
  | { kind: "commit"; hash: string; path: string; origPath?: string; status: string };
