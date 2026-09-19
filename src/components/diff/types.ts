/** Line-by-line changes to one file, as the backend's `FileDiff`. */
export type DiffLine = {
  tag: "add" | "del" | "ctx";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type DiffHunk = {
  /** `@@ -1,4 +1,5 @@ fn main()` */
  header: string;
  lines: DiffLine[];
};

export type FileDiff = {
  kind: "text" | "binary" | "too-large" | "unavailable";
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

export type DiffLayout = "unified" | "split";
