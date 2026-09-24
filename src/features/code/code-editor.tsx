"use client";

import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import type { Problem } from "./problems";

function languageFor(rel: string): Extension[] {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return [javascript({ jsx: true })];
    case "json":
    case "jsonc":
      return [json()];
    case "rs":
      return [rust()];
    case "py":
      return [python()];
    case "go":
      return [go()];
    case "css":
    case "scss":
    case "less":
      return [css()];
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return [html()];
    case "md":
    case "mdx":
      return [markdown()];
    case "yml":
    case "yaml":
      return [yaml()];
    case "sql":
      return [sql()];
    default:
      return [];
  }
}

// Lines an outside change (usually the agent) just touched glow for a moment.
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashLine = Decoration.line({ class: "cm-agent-flash" });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFlash)) continue;
      if (!effect.value) {
        next = Decoration.none;
        continue;
      }
      const doc = tr.state.doc;
      const builder = new RangeSetBuilder<Decoration>();
      const last = Math.min(effect.value.to, doc.lines, effect.value.from + 400);
      for (let line = Math.max(1, effect.value.from); line <= last; line++) {
        const start = doc.line(line).from;
        builder.add(start, start, flashLine);
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent !important" },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 55%, transparent) !important" },
  ".cm-activeLineGutter": { backgroundColor: "transparent !important" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-gutters": { backgroundColor: "transparent !important", borderRight: "none" },
  ".cm-agent-flash": {
    backgroundColor: "color-mix(in oklch, var(--chart-2) 22%, transparent)",
    transition: "background-color 1.2s ease",
  },
});

export type EditorSelection = { from: number; to: number; text: string };

/** Where ⌘K was pressed, relative to the editor's box, to place the popup. */
export type InlineAnchor = EditorSelection & { top: number; bottom: number };

/** The selected lines, or the cursor's line when nothing is selected. */
function linesAt(state: EditorState): EditorSelection {
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  // A selection ending at the start of a line doesn't include that line.
  const endPos = !range.empty && range.to > range.from && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to;
  const last = state.doc.lineAt(Math.max(range.from, endPos));
  return {
    from: first.number,
    to: last.number,
    text: range.empty ? first.text : state.sliceDoc(first.from, last.to),
  };
}

type Props = {
  rel: string;
  value: string;
  readOnly?: boolean;
  flash?: { from: number; to: number; at: number };
  problems: Problem[];
  /** Line to scroll to and put the cursor on; `at` makes repeats count. */
  reveal?: { line: number; column?: number; at: number };
  onChange: (text: string) => void;
  onSave: () => void;
  onSelection: (selection: EditorSelection | undefined) => void;
  /** ⌘L: add the selected lines (or this line) to the chat. */
  onAddToChat?: (selection: EditorSelection) => void;
  /** ⌘K: edit the selected lines (or this line) from a prompt at the cursor. */
  onInlineEdit?: (anchor: InlineAnchor) => void;
};

export function CodeEditor({
  rel,
  value,
  readOnly,
  flash,
  problems,
  reveal,
  onChange,
  onSave,
  onSelection,
  onAddToChat,
  onInlineEdit,
}: Props) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const { resolvedTheme } = useTheme();
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const selectionRef = useRef(onSelection);
  selectionRef.current = onSelection;
  const addRef = useRef(onAddToChat);
  addRef.current = onAddToChat;
  const inlineRef = useRef(onInlineEdit);
  inlineRef.current = onInlineEdit;

  const extensions = useMemo(
    () => [
      ...languageFor(rel),
      baseTheme,
      flashField,
      EditorView.lineWrapping,
      // Above the defaults: ⌘L would otherwise select the line.
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              saveRef.current();
              return true;
            },
          },
          {
            key: "Mod-l",
            preventDefault: true,
            run: (view) => {
              if (!addRef.current) return false;
              addRef.current(linesAt(view.state));
              return true;
            },
          },
          {
            key: "Mod-k",
            preventDefault: true,
            run: (view) => {
              if (!inlineRef.current) return false;
              const lines = linesAt(view.state);
              const box = view.dom.getBoundingClientRect();
              const top = view.coordsAtPos(view.state.doc.line(lines.from).from);
              const bottom = view.coordsAtPos(view.state.doc.line(lines.to).to);
              inlineRef.current({
                ...lines,
                top: (top?.top ?? box.top) - box.top,
                bottom: (bottom?.bottom ?? top?.bottom ?? box.top + 20) - box.top,
              });
              return true;
            },
          },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        const { state } = update;
        const range = state.selection.main;
        if (range.empty) {
          selectionRef.current(undefined);
          return;
        }
        selectionRef.current({
          from: state.doc.lineAt(range.from).number,
          to: state.doc.lineAt(range.to).number,
          text: state.sliceDoc(range.from, range.to),
        });
      }),
    ],
    [rel, readOnly],
  );

  // Flash what changed, and keep it in view if it's off screen.
  useEffect(() => {
    const view = ref.current?.view;
    if (!view || !flash) return;
    const line = Math.min(flash.from, view.state.doc.lines);
    view.dispatch({
      effects: [setFlash.of(flash), EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" })],
    });
    const id = window.setTimeout(() => view.dispatch({ effects: setFlash.of(null) }), 2200);
    return () => window.clearTimeout(id);
  }, [flash?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build errors as squiggles and gutter markers.
  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    const doc = view.state.doc;
    const diagnostics: Diagnostic[] = problems
      .filter((p) => p.line >= 1 && p.line <= doc.lines)
      .map((p) => {
        const line = doc.line(p.line);
        const from = Math.min(line.from + Math.max(0, (p.column ?? 1) - 1), line.to);
        return { from, to: line.to > from ? line.to : from, severity: p.severity, message: p.message };
      });
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [problems, value]);

  useEffect(() => {
    const view = ref.current?.view;
    if (!view || !reveal) return;
    const line = view.state.doc.line(Math.min(Math.max(1, reveal.line), view.state.doc.lines));
    const pos = Math.min(line.from + Math.max(0, (reveal.column ?? 1) - 1), line.to);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  }, [reveal?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      className="h-full min-h-0 [&_.cm-editor]:h-full [&_.cm-editor.cm-focused]:outline-none"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      readOnly={readOnly}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ highlightActiveLine: true, foldGutter: true, bracketMatching: true, autocompletion: true }}
    />
  );
}
