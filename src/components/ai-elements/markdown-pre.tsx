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
 * Models often leave the language off a fence. Plain text then renders with
 * no colors, so make a cheap guess from the code itself.
 */
export function guessLanguage(code: string): string {
  const text = code.trim();
  if (!text) return "text";
  if (/^[[{]/.test(text)) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      // Not JSON; keep looking.
    }
  }
  if (/^(\$ |npm |npx |bun |pnpm |yarn |cargo |git |cd |brew |pip |curl )/m.test(text)) return "bash";
  if (/^\s*(fn |use |impl |pub (fn|struct|enum)|let mut )/m.test(text)) return "rust";
  if (/^\s*(def |class \w+(\(.*\))?:|from \w+ import |import \w+$)/m.test(text)) return "python";
  if (/^\s*(package \w+|func \w+\()/m.test(text)) return "go";
  if (/<\/?[A-Za-z][\w.]*[\s/>]/.test(text) && /(import |export |return|const |=>|className=)/.test(text)) return "tsx";
  if (/^\s*<(!doctype|html|div|body|head)/i.test(text)) return "html";
  if (/(^|\n)\s*(import |export |const |let |function |interface |type \w+ =)/.test(text)) return "typescript";
  if (/^[.#@]?[\w-]+[^{]*\{[^}]*:[^}]*;/m.test(text)) return "css";
  return "text";
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
  type CodeProps = { className?: string; children?: ReactNode; node?: { tagName?: string } };
  // Streamdown hands over its own `code` component, not a bare `<code>`;
  // either way the single child is the fenced code.
  const only = items.length === 1 && isValidElement<CodeProps>(items[0]) ? (items[0] as ReactElement<CodeProps>) : null;
  const codeEl = only && (only.type === "code" || only.props.node?.tagName === "code") ? only : null;

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

  const code = codeText(codeEl.props.children).replace(/\n$/, "");
  const tagged = languageOf(codeEl);
  const language = tagged === "text" ? guessLanguage(code) : tagged;
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
