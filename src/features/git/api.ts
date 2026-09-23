import type { FileDiff } from "@/components/diff/types";
import { invoke } from "@tauri-apps/api/core";
import type { ChangedFile, CommitContext, DiffTarget, GitBranch, GitCommit, GitCommitFile, GitStatus } from "./types";

/** Every call takes the chat's folder; the backend finds the repository around it. */
export const gitApi = {
  status: (folder: string) => invoke<GitStatus>("git_status", { folder }),
  changes: (folder: string) => invoke<ChangedFile[]>("git_changes", { folder }),

  diff: (folder: string, target: DiffTarget) =>
    target.kind === "worktree"
      ? invoke<FileDiff>("git_file_diff", {
          folder,
          path: target.path,
          origPath: target.origPath ?? null,
          area: target.area,
        })
      : invoke<FileDiff>("git_commit_file_diff", {
          folder,
          hash: target.hash,
          path: target.path,
          origPath: target.origPath ?? null,
        }),

  stage: (folder: string, paths: string[]) => invoke<void>("git_stage", { folder, paths }),
  stageAll: (folder: string) => invoke<void>("git_stage_all", { folder }),
  unstage: (folder: string, paths: string[]) => invoke<void>("git_unstage", { folder, paths }),
  discard: (folder: string, paths: string[]) => invoke<void>("git_discard", { folder, paths }),
  commit: (folder: string, message: string, stageAll: boolean) =>
    invoke<{ hash: string; subject: string }>("git_commit", { folder, message, stageAll }),
  commitContext: (folder: string) => invoke<CommitContext>("git_commit_context", { folder }),

  log: (folder: string, skip: number, limit: number) => invoke<GitCommit[]>("git_log", { folder, skip, limit }),
  commitFiles: (folder: string, hash: string) => invoke<GitCommitFile[]>("git_commit_files", { folder, hash }),

  /** Lower-cased email → GitHub avatar URL for recent commit authors. */
  avatars: (folder: string) => invoke<Record<string, string>>("git_avatars", { folder }),

  branches: (folder: string) => invoke<GitBranch[]>("git_branches", { folder }),
  switchBranch: (folder: string, name: string, remote: boolean) =>
    invoke<void>("git_switch_branch", { folder, name, remote }),
  createBranch: (folder: string, name: string) => invoke<void>("git_create_branch", { folder, name }),

  stash: (folder: string) => invoke<{ message: string }>("git_stash", { folder }),

  fetch: (folder: string) => invoke<{ message: string }>("git_fetch", { folder }),
  pull: (folder: string) => invoke<{ message: string }>("git_pull", { folder }),
  push: (folder: string) => invoke<{ message: string }>("git_push", { folder }),
};
