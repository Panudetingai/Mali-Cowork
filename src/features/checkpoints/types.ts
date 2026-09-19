export type FileChangeKind = "added" | "modified" | "deleted";

/** One file an agent changed during a turn. */
export type FileChange = {
  path: string;
  /** Path inside the folder it belongs to, for display. */
  relative: string;
  kind: FileChangeKind;
  size?: number;
  additions?: number;
  deletions?: number;
  /** Both sides were saved, so undo and redo can restore it. */
  restorable: boolean;
};

/** What a Cowork turn changed on disk, kept on the reply that ended it. */
export type TurnFiles = {
  checkpointId: string;
  changes: FileChange[];
  /** Some files were too large or private to save; they can't be restored. */
  partial?: boolean;
  /** `undone` after Undo; files are as they were before the turn. */
  state: "applied" | "undone";
};

export type TurnChanges = {
  id: string;
  changes: FileChange[];
  partial: boolean;
};

export type RestoreResult = {
  restored: string[];
  /** Changed since the turn; left alone unless forced. */
  conflicts: string[];
  /** Can't be restored (content wasn't saved). */
  skipped: string[];
  errors: string[];
};

export type { DiffHunk, DiffLine, FileDiff } from "@/components/diff/types";

export type FilePreview = {
  kind: "text" | "markdown" | "image" | "pdf" | "document" | "binary" | "unavailable";
  name: string;
  mime: string;
  text?: string;
  /** Base64 bytes for pictures and PDFs. */
  data?: string;
  language?: string;
  deleted: boolean;
  note?: string;
};
