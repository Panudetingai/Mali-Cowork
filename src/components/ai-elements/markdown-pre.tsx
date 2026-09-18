"use client";

import { cn } from "@/lib/utils";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { BundledLanguage } from "shiki";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block";

/** Plain text out of a (possibly highlighted) `<code>` subtree. */
function codeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(codeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return codeText(node.props.children);
  return "";
}

function languageOf(codeEl: ReactElement<{ className?: string }>): string {
  const m = /language-([\w+-]+)/.exec(codeEl.props.className ?? "");
  return m?.[1]?.toLowerCase() ?? "text";
}

/**
 * Renders fenced code blocks with the app's own clean chrome: a slim header
 * with the language name, a copy button, scrollable body and line numbers on
 * long snippets.
 *
 * Anything that is not exactly one `<code>` child (e.g. a fenced block nested
 * inside a streamed fragment, or markdown showing markdown) falls back to a
 * plain scrollable `<pre>` so blocks can never nest chrome inside chrome.
 */
type MarkdownPreProps = {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
};

export function MarkdownPre({ children, className }: MarkdownPreProps) {
  const items = Children.toArray(children);
  const codeEl =
    items.length === 1 && isValidElement<{ className?: string; children?: ReactNode }>(items[0]) && items[0].type === "code"
      ? (items[0] as ReactElement<{ className?: string; children?: ReactNode }>)
      : null;

  if (!codeEl) {
    return (
      <pre
        className={cn(
          "chat-nested-pre my-3 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-[0.8125rem] leading-relaxed text-foreground",
          className,
        )}
      >
        {children}
      </pre>
    );
  }

  const language = languageOf(codeEl);
  const code = codeText(codeEl.props.children).replace(/\n$/, "");
  const lines = code.split("\n").length;

  // Fenced markdown / plain text: avoid heavy chrome so nested blocks stay readable.
  if (language === "markdown" || language === "md" || language === "text") {
    return (
      <pre
        className={cn(
          "chat-nested-pre my-3 overflow-x-auto rounded-lg border border-dashed border-border/80 bg-background/80 p-3 font-mono text-[0.8125rem] leading-relaxed text-foreground",
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <CodeBlock
      code={code}
      language={language as BundledLanguage}
      showLineNumbers={lines > 10}
      className={cn("my-0", className)}
    >
      <CodeBlockHeader className="py-1.5">
        <CodeBlockTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {language}
          {lines > 1 && <span className="font-normal normal-case"> · {lines} lines</span>}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton className="size-7" />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
}
