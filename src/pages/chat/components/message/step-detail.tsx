"use client";

import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";
import { TerminalIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { BundledLanguage } from "shiki";

/** macOS / GNU `ls -la` data row */
const LS_ROW =
  /^([\-dlcbspLNsS?][\-rwxstSTUGoO@+.]{9,12})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+(?:\s+\d+)?(?:\s+\d{1,2}:\d{2})?(?:\s+\d{4})?)\s+(.+)$/;

function colorPath(text: string) {
  const parts = text.split(/(\/~?[\w./-]+)/g);
  return parts.map((part, index) =>
    /^(\/|~)/.test(part) ? (
      <span key={index} className="text-sky-600 dark:text-sky-400">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function TerminalLine({ line }: { line: string }) {
  const text = line.trimEnd();
  if (!text) return "\n";

  if (/^\$\s/.test(text)) {
    return (
      <>
        <span className="text-emerald-600 dark:text-emerald-400">$ </span>
        <span className="text-foreground/90">{colorPath(text.slice(2))}</span>
      </>
    );
  }

  if (/^>\s/.test(text)) {
    return (
      <>
        <span className="text-emerald-600 dark:text-emerald-400">{"> "}</span>
        <span className="text-foreground/90">{colorPath(text.slice(2))}</span>
      </>
    );
  }

  if (/^total\s+\d+/.test(text)) {
    return <span className="text-muted-foreground">{text}</span>;
  }

  if (/:$/.test(text) && !/\s/.test(text.slice(0, -1))) {
    return <span className="font-medium text-sky-600 dark:text-sky-400">{text}</span>;
  }

  const ls = LS_ROW.exec(text);
  if (ls) {
    const [, perms, links, user, group, size, date, name] = ls;
    const isDir = perms.startsWith("d");
    const isLink = perms.startsWith("l");
    return (
      <>
        <span className="text-teal-600 dark:text-teal-400">{perms}</span>
        <span className="text-muted-foreground/75">
          {" "}
          {links} {user} {group}{" "}
        </span>
        <span className="text-amber-700/90 dark:text-amber-400/90">{size}</span>
        <span className="text-muted-foreground/65"> {date} </span>
        <span
          className={cn(
            isDir && "font-semibold text-sky-600 dark:text-sky-400",
            isLink && "text-cyan-600 dark:text-cyan-400",
            !isDir && !isLink && "text-foreground/85",
          )}
        >
          {name}
        </span>
      </>
    );
  }

  if (/^(error|fatal|failed|cannot|permission denied)/i.test(text)) {
    return <span className="text-red-600 dark:text-red-400">{text}</span>;
  }

  if (/^(warning|warn:)/i.test(text)) {
    return <span className="text-amber-700 dark:text-amber-400">{text}</span>;
  }

  return <span className="text-foreground/80">{text}</span>;
}

function TerminalOutput({ detail }: { detail: string }) {
  const lines = detail.replace(/\r\n/g, "\n").split("\n");

  return (
    <div className="mt-0.5 mb-0.5 ml-8 max-h-60 overflow-auto rounded-md">
      <pre className="overflow-x-auto h-full font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        <code>
          {lines.map((line, index) => (
            <span key={index} className="block">
              <TerminalLine line={line} />
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function isTerminalVerb(verb: string) {
  return /^(run|bash|shell|exec|command)/i.test(verb);
}

function isDiffDetail(verb: string, detail: string) {
  return (
    /^diff --git|^---\s|^\+{3}\s|^@@\s/m.test(detail) ||
    (/^(write|edit|patch|update)/i.test(verb) && /[-+]{3}|^@@\s/m.test(detail))
  );
}

function DiffOutput({ detail }: { detail: string }) {
  return (
    <CodeBlock
      code={detail}
      language={"diff" as BundledLanguage}
      className="mt-0.5 mb-1.5 ml-8 max-h-60 overflow-auto [&_pre]:px-3 [&_pre]:py-2 [&_pre]:text-[11px] [&_code]:text-[11px] [&_pre]:leading-relaxed"
    >
      <CodeBlockHeader className="px-2.5 py-1">
        <CodeBlockTitle className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          diff
        </CodeBlockTitle>
      </CodeBlockHeader>
    </CodeBlock>
  );
}

export function StepDetail({ detail, verb }: { detail: string; verb: string }) {
  let body: ReactNode;
  if (isDiffDetail(verb, detail)) {
    body = <DiffOutput detail={detail} />;
  } else if (isTerminalVerb(verb) || /^(\$|>)\s/m.test(detail)) {
    body = <TerminalOutput detail={detail} />;
  } else {
    body = (
      <pre className="mt-0.5 mb-1.5 ml-8 max-h-60 overflow-auto rounded-md px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
        {detail}
      </pre>
    );
  }
  return body;
}
