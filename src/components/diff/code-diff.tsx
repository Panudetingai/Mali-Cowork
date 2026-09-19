import { highlightCode } from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { bundledLanguages, type BundledLanguage, type ThemedToken } from "shiki";
import type { DiffLine, FileDiff } from "./types";

/** Lines drawn before "Show all"; long diffs stay quick to open. */
const INITIAL_LINES = 400;

const ALIASES: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  yml: "yaml",
  rs: "rust",
  py: "python",
  rb: "ruby",
  md: "markdown",
  sh: "bash",
  zsh: "bash",
  h: "c",
  hpp: "cpp",
  kt: "kotlin",
  cs: "csharp",
  htm: "html",
};

/** The shiki language for a file name; `text` when there's none. */
export function languageFor(path: string): BundledLanguage | "text" {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const lang = ALIASES[ext] ?? ext;
  return lang in bundledLanguages ? (lang as BundledLanguage) : "text";
}

type Row = { kind: "hunk"; header: string } | { kind: "line"; line: DiffLine; index: number };

/** Highlighted tokens per line, once the highlighter has loaded. */
function useTokens(code: string, language: BundledLanguage | "text") {
  const [tokens, setTokens] = useState<ThemedToken[][]>();
  useEffect(() => {
    setTokens(undefined);
    if (language === "text" || !code) return;
    let cancelled = false;
    const done = highlightCode(code, language, (result) => !cancelled && setTokens(result.tokens));
    if (done) setTokens(done.tokens);
    return () => {
      cancelled = true;
    };
  }, [code, language]);
  return tokens;
}

/**
 * A file's changes as highlighted code: one line-number column, added lines
 * green and removed lines red, with a bar down their left edge.
 */
export function CodeDiff({ diff, path }: { diff: FileDiff; path: string }) {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => diff.hunks.flatMap((h) => h.lines), [diff]);
  const code = useMemo(() => lines.map((l) => l.text).join("\n"), [lines]);
  const tokens = useTokens(code, languageFor(path));

  // A new or deleted file is one block: no "@@" line needed.
  const oneSided = lines.every((l) => l.tag === "add") || lines.every((l) => l.tag === "del");
  const rows = useMemo(() => {
    const out: Row[] = [];
    let index = 0;
    for (const hunk of diff.hunks) {
      if (!oneSided) out.push({ kind: "hunk", header: hunk.header });
      for (const line of hunk.lines) out.push({ kind: "line", line, index: index++ });
    }
    return out;
  }, [diff, oneSided]);

  if (diff.kind !== "text") {
    const note = {
      binary: "Binary file — no lines to show.",
      "too-large": "Too large to show line by line.",
      unavailable: "This change can't be shown.",
    }[diff.kind];
    return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{note}</p>;
  }
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-muted-foreground">No line changes (mode or empty file).</p>;
  }

  const visible = showAll ? rows : rows.slice(0, INITIAL_LINES);
  return (
    <div className="overflow-x-auto font-mono text-[12.5px] leading-[1.65]">
      <div className="w-max min-w-full">
        {visible.map((row, i) =>
          row.kind === "hunk" ? (
            <div
              key={`h${i}`}
              className="flex items-center gap-2 border-y border-border/60 bg-muted/40 px-3 py-0.5 text-[11px] whitespace-pre text-muted-foreground"
            >
              <span className="select-none">⋯</span>
              <span>{row.header}</span>
            </div>
          ) : (
            <LineRow key={`l${i}`} line={row.line} tokens={tokens?.[row.index]} />
          ),
        )}
        {!showAll && rows.length > INITIAL_LINES && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full border-t py-2 text-center text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            Show {rows.length - INITIAL_LINES} more lines
          </button>
        )}
      </div>
    </div>
  );
}

function LineRow({ line, tokens }: { line: DiffLine; tokens?: ThemedToken[] }) {
  const number = line.tag === "del" ? line.oldLine : line.newLine;
  return (
    <div
      className={cn(
        "flex border-l-2",
        line.tag === "add" && "border-emerald-500/80 bg-emerald-500/10 dark:bg-emerald-500/15",
        line.tag === "del" && "border-red-500/80 bg-red-500/10 dark:bg-red-500/15",
        line.tag === "ctx" && "border-transparent",
      )}
    >
      <span
        className={cn(
          "w-12 shrink-0 select-none pr-3 text-right tabular-nums",
          line.tag === "add"
            ? "text-emerald-700/70 dark:text-emerald-400/70"
            : line.tag === "del"
              ? "text-red-700/70 dark:text-red-400/70"
              : "text-muted-foreground/50",
        )}
      >
        {number}
      </span>
      <span className="flex-1 whitespace-pre pr-6">
        {tokens && tokens.length > 0
          ? tokens.map((token, i) => (
              <span
                key={i}
                className="dark:!text-[var(--shiki-dark)]"
                style={{ color: token.color, ...(token.htmlStyle as CSSProperties) }}
              >
                {token.content}
              </span>
            ))
          : line.text || " "}
      </span>
    </div>
  );
}
