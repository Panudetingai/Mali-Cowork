"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CodeEditor,
  FileTree,
  isDirty,
  problemPath,
  ReviewBar,
  TurnReviewDiff,
  isMarkdownRel,
  MarkdownFilePreview,
  RunPanel,
  RunStatus,
  outputForModel,
  useCodeRunner,
  useCodeWorkspace,
  useStoredBool,
  useTurnReview,
  FileTypeIcon,
  InlineEdit,
  type CodeRun,
  type EditorSelection,
  type InlineAnchor,
  type Problem,
} from "@/features/code";
import { GitPanel, useGitRepo } from "@/features/git";
import type { Project } from "@/features/projects";
import { findGrant, folderName, normalizeFolder, requestFolderAccess, useFolderGrants } from "@/features/workspace";
import { cn } from "@/lib/utils";
import { useChat, type SendMessage } from "@/pages/chat/hooks/use-chat";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  CodeXmlIcon,
  CrosshairIcon,
  EyeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  LoaderIcon,
  MessageSquareIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlayIcon,
  PlusIcon,
  QuoteIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChatComposer } from "./chat-composer";
import { ChatMessagePanel } from "./chat-message-panel";
import { CodeChatContext } from "./message/code-chat-context";
import { ChatModeNav } from "./chat-mode-nav";
import type { ViewMode } from "./work-mode-toggle";

/** How many times Auto-fix asks the agent before handing back to the user. */
const MAX_AUTO_FIX = 3;
const AUTO_FIX_PREFIX = "Auto-fix";
/**
 * Files that decide what a build runs. Auto-check never runs a command right
 * after the agent changed one of these: that would run whatever the agent
 * wrote without the permission prompt its own commands go through.
 */
const BUILD_CONFIG =
  /(^|\/)(package\.json|Makefile|makefile|Cargo\.toml|build\.rs|pyproject\.toml|setup\.py|go\.mod|[^/]*\.config\.[cm]?[jt]s)$/;

type Props = {
  chat: ReturnType<typeof useChat>;
  chatId?: string;
  project?: Project;
  /** The project folder: the chat's, or the default for a new chat. */
  root?: string;
  withGit: boolean;
  onModeChange: (mode: ViewMode) => void;
  onNewChat: (options?: { cwd?: string }) => void;
  onPickDefaultFolder: (path: string) => void;
};

function readNumber(key: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/** A pane size the user drags, remembered across launches. */
function useDragSize(key: string, fallback: number, min: number, max: number, axis: "x" | "y", invert = false) {
  const [size, setSize] = useState(() => Math.min(max, Math.max(min, readNumber(key, fallback))));
  const start = (event: ReactPointerEvent) => {
    event.preventDefault();
    const origin = axis === "x" ? event.clientX : event.clientY;
    const initial = size;
    let latest = initial;
    const move = (e: PointerEvent) => {
      const delta = (axis === "x" ? e.clientX : e.clientY) - origin;
      latest = Math.min(max, Math.max(min, initial + (invert ? -delta : delta)));
      setSize(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      try {
        localStorage.setItem(key, String(Math.round(latest)));
      } catch {
        // Lasts for this session only.
      }
    };
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return [size, start] as const;
}

function ToolbarToggle({
  on,
  label,
  hint,
  onClick,
  children,
}: {
  on: boolean;
  label?: string;
  hint: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={on}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap transition-colors",
        on ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
      {label && <span className="hidden 2xl:inline">{label}</span>}
    </button>
  );
}

function fileName(rel: string) {
  return rel.split("/").pop() || rel;
}

function languageTag(rel: string) {
  return rel.split(".").pop()?.toLowerCase() ?? "";
}

export function CodeView({ chat, chatId, project, root, withGit, onModeChange, onNewChat, onPickDefaultFolder }: Props) {
  const {
    session,
    mode,
    messages,
    isLoading,
    hasMessages,
    containerRef,
    atBottom,
    scrollToBottom,
    promptInputRef,
    sendMessage,
    sendText,
    retryMessage,
    editAndResend,
    rateMessage,
    summarizeAndContinue,
    permissions,
    replyPermission,
    allowFolder,
    questions,
    answerQuestion,
    canStop,
    stop,
  } = chat;

  const workspace = useCodeWorkspace(root, isLoading);
  const runner = useCodeRunner(root);
  const [explorerOpen, setExplorerOpen] = useStoredBool("code_explorer_open", true);
  const [bottomOpen, setBottomOpen] = useStoredBool("code_bottom_open", true);
  const [chatOpen, setChatOpen] = useStoredBool("code_chat_open", true);
  const [autoCheck, setAutoCheck] = useStoredBool("code_auto_check", false);
  const [skipped, setSkipped] = useState<string>();
  useFolderGrants(); // re-render when access changes
  const grant = root ? findGrant(root) : undefined;
  const readOnly = grant?.access !== "write";
  const [autoFix, setAutoFix] = useStoredBool("code_auto_fix", false);
  const [chatWidth, dragChat] = useDragSize("code_right_width", 460, 380, 900, "x", true);
  const git = useGitRepo();
  const gitOpen = withGit && !!git?.panel.open;
  // ⇧⌘G: Git's branch pill isn't in Code mode's chat pane; the shortcut flips to the Git tab.
  const gitRef = useRef(git);
  gitRef.current = git;
  useEffect(() => {
    if (!withGit) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
      if (!mod || !e.shiftKey || e.key.toLowerCase() !== "g") return;
      e.preventDefault();
      const current = gitRef.current;
      if (current?.panel.open) current.closePanel();
      else current?.openPanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [withGit]);
  // The Git bar (⇧⌘G) opens Git in the right pane; make sure the pane is there.
  useEffect(() => {
    if (gitOpen) setChatOpen(true);
  }, [gitOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const [explorerWidth, dragExplorer] = useDragSize("code_explorer_width", 240, 180, 420, "x");
  const [bottomHeight, dragBottom] = useDragSize("code_bottom_height", 220, 120, 520, "y", true);
  const [selection, setSelection] = useState<EditorSelection>();
  /** Code the user pinned to go with their next message. */
  /** Code added with ⌘L, sent with the next message. */
  const [quotes, setQuotes] = useState<({ rel: string } & EditorSelection)[]>([]);
  /** ⌘K popup, and whether the agent is working on it. */
  const [inline, setInline] = useState<{ rel: string; anchor: InlineAnchor; busy: boolean }>();
  const editorBoxRef = useRef<HTMLDivElement>(null);

  const addQuote = useCallback(
    (rel: string, lines: EditorSelection) => {
      setQuotes((prev) =>
        prev.some((q) => q.rel === rel && q.from === lines.from && q.to === lines.to) ? prev : [...prev, { rel, ...lines }],
      );
      setChatOpen(true);
      git?.closePanel();
      // After the pane opens.
      requestAnimationFrame(() => promptInputRef.current?.focus());
    },
    [git, promptInputRef], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [reveal, setReveal] = useState<{ rel: string; line: number; column?: number; at: number }>();
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);

  const submitCustomCommand = useCallback(() => {
    const cmd = customDraft.trim();
    if (!cmd) return;
    runner.addCustom(cmd);
    setCustomOpen(false);
    setCommandMenuOpen(false);
    setCustomDraft("");
  }, [customDraft, runner]);

  const activeFile = workspace.files.find((f) => f.rel === workspace.active);
  const dirty = useMemo(() => new Set(workspace.files.filter(isDirty).map((f) => f.rel)), [workspace.files]);
  const problems = runner.run?.problems ?? [];

  const problemsByFile = useMemo(() => {
    const map = new Map<string, Problem[]>();
    if (!root || !runner.run) return map;
    for (const problem of problems) {
      const rel = problemPath(problem, root, runner.run.task.cwd);
      if (!rel) continue;
      map.set(rel, [...(map.get(rel) ?? []), problem]);
    }
    return map;
  }, [problems, root, runner.run]);

  useEffect(() => setSelection(undefined), [workspace.active]);

  const openProblem = (problem: Problem) => {
    if (!root || !runner.run) return;
    const rel = problemPath(problem, root, runner.run.task.cwd);
    if (!rel) return;
    workspace.open(rel);
    setReveal({ rel, line: problem.line, column: problem.column, at: Date.now() });
  };

  const openFile = workspace.open;
  const codeChat = useMemo(
    () => ({
      openFile: (path: string) => {
        if (!root) return;
        const base = normalizeFolder(root);
        if (path.startsWith(base)) openFile(path.slice(base.length).replace(/\\/g, "/").replace(/^\/+/, ""));
      },
    }),
    [root, openFile],
  );

  const openInline = useCallback((rel: string, anchor: InlineAnchor) => setInline({ rel, anchor, busy: false }), []);

  /** ⌘K: ask the agent to change just these lines; the result lands in review. */
  const submitInline = async (instruction: string) => {
    if (!inline) return;
    const { rel, anchor } = inline;
    await workspace.saveAll();
    const lines = anchor.from === anchor.to ? `line ${anchor.from}` : `lines ${anchor.from}–${anchor.to}`;
    const context = [
      "",
      "",
      `[Inline edit] Change ${lines} of \`${rel}\` to do what the user asked. Edit the file directly.`,
      "Keep the rest of the file as it is, and don't touch other files unless the change needs it.",
      "Reply with one short sentence about what you changed.",
      `Current ${lines}:`,
      `\`\`\`${languageTag(rel)}`,
      anchor.text,
      "```",
    ].join("\n");
    setInline((current) => (current ? { ...current, busy: true } : current));
    const sent = await sendText(`Edit \`${fileName(rel)}\` ${lines}: ${instruction}`, context);
    if (!sent) setInline((current) => (current ? { ...current, busy: false } : current));
  };

  // The inline edit is done when its turn ends; review takes it from there.
  const wasRunning = useRef(isLoading);
  useEffect(() => {
    if (wasRunning.current && !isLoading) setInline((current) => (current?.busy ? undefined : current));
    wasRunning.current = isLoading;
  }, [isLoading]);

  /** What the model should know about the editor: the open file, and quoted code. */
  const editorContext = () => {
    const parts: string[] = [];
    if (activeFile) parts.push(`[Code mode] The user has \`${activeFile.rel}\` open in the editor.`);
    for (const quote of quotes) {
      parts.push(
        `The user quoted lines ${quote.from}–${quote.to} of \`${quote.rel}\`:\n\`\`\`${languageTag(quote.rel)}\n${quote.text}\n\`\`\``,
      );
    }
    // Appended to the prompt, like `@` mentions: it starts on its own paragraph.
    return parts.length ? `\n\n${parts.join("\n")}` : "";
  };

  // The agent works on what's on disk, so the user's edits are saved first.
  const submit = async (payload: SendMessage) => {
    await workspace.saveAll();
    const context = (payload.context ?? "") + editorContext();
    const sent = await sendMessage({ ...payload, context });
    if (sent) setQuotes([]);
    return sent;
  };

  const askToFix = useCallback(
    async (attempt?: number, finished: CodeRun | undefined = runner.run) => {
      const run = finished;
      if (!run?.exit) return false;
      await workspace.saveAll();
      const errors = run.problems.filter((p) => p.severity === "error").length;
      const what = errors ? `${errors} error${errors > 1 ? "s" : ""}` : "the failure";
      const prompt = attempt
        ? `${AUTO_FIX_PREFIX} (attempt ${attempt}/${MAX_AUTO_FIX}): fix ${what} from \`${run.task.command}\``
        : `Fix ${what} from \`${run.task.command}\``;
      const context = [
        "",
        "",
        `\`${run.task.command}\`${run.task.cwd ? ` (run in \`${run.task.cwd}\`)` : ""} failed with exit code ${run.exit.code ?? "unknown"}.`,
        "Output:",
        "```text",
        outputForModel(run.lines.filter((l) => l.stream !== "info").map((l) => l.text)),
        "```",
        "Find the root cause and fix it with the smallest change that makes this command pass. Don't touch unrelated code. " +
          "Run the command yourself to confirm if you can, then say briefly what was wrong and what you changed.",
      ].join("\n");
      return sendText(prompt, context);
    },
    [runner.run, sendText, workspace],
  );

  // After a turn that changed files: check the build, and (with Auto-fix)
  // send the errors back. The turn's file list lands just after the reply
  // ends, so that is what this waits for; turns seen at mount don't count.
  const lastTurn = [...messages].reverse().find((m) => m.role === "assistant" || m.role === "error")?.turn;
  const lastTurnId = lastTurn?.state === "applied" && lastTurn.changes.length > 0 ? lastTurn.checkpointId : undefined;
  const seenTurn = useRef(lastTurnId);

  // Review the last turn file by file (Keep / Undo), once the agent is done.
  const lastTurnMessage = [...messages].reverse().find((m) => m.role === "assistant" || m.role === "error");
  const reviewTarget = useMemo(
    () =>
      chatId && !isLoading && lastTurnMessage?.turn
        ? { chatId, messageId: lastTurnMessage.id, turn: lastTurnMessage.turn }
        : undefined,
    [chatId, isLoading, lastTurnMessage?.id, lastTurnMessage?.turn], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const review = useTurnReview(reviewTarget, root, workspace);
  const reviewing = useMemo(() => new Map(review.pending.map((f) => [f.rel, f.kind])), [review.pending]);
  const [mdPreview, setMdPreview] = useState(false);
  const reviewingActive =
    !!activeFile && review.current?.rel === activeFile.rel && !!review.checkpointId;
  useEffect(() => {
    setMdPreview(false);
  }, [activeFile?.rel]);
  useEffect(() => {
    if (!lastTurnId || seenTurn.current === lastTurnId) return;
    seenTurn.current = lastTurnId;
    // Start the review on the first changed file.
    const first = lastTurn?.changes.find((c) => root && c.path.startsWith(normalizeFolder(root)) && c.kind !== "deleted");
    if (first && root) workspace.open(first.path.slice(normalizeFolder(root).length).replace(/\\/g, "/").replace(/^\/+/, ""));
    const task = runner.selected;
    if (!autoCheck || !task || task.kind === "dev" || runner.running) return;
    const config = lastTurn?.changes.find((c) => BUILD_CONFIG.test(c.relative.replace(/\\/g, "/")));
    if (config) {
      setSkipped(`Auto-check skipped: the agent changed ${config.relative}. Review it, then press Run.`);
      return;
    }
    setSkipped(undefined);
    void runner.start(task).then((result) => {
      if (!result || result.ok || !autoFix || result.run.exit?.code == null) return;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const previous = lastUser?.content.startsWith(AUTO_FIX_PREFIX)
        ? Number(lastUser.content.match(/attempt (\d+)/)?.[1] ?? 0)
        : 0;
      if (previous < MAX_AUTO_FIX) void askToFixRef.current(previous + 1, result.run);
    });
  }, [lastTurnId]); // eslint-disable-line react-hooks/exhaustive-deps
  const askToFixRef = useRef(askToFix);
  askToFixRef.current = askToFix;

  const pickFolder = async () => {
    const folder = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: root || undefined,
      title: "Open a project folder",
    });
    if (typeof folder !== "string" || !folder) return;
    if (!(await requestFolderAccess(folder))) return;
    const path = normalizeFolder(folder);
    if (session?.cwd) {
      if (path !== normalizeFolder(session.cwd)) onNewChat({ cwd: path });
      return;
    }
    onPickDefaultFolder(path);
  };

  const runTask = () => {
    setSkipped(undefined);
    if (runner.running) runner.stop();
    else void workspace.saveAll().then(() => runner.start());
  };

  const composer = (
    <ChatComposer
      key={`${chatId ?? "new"}:${mode}:${project?.id ?? ""}`}
      mode={mode}
      projectId={project?.id}
      session={session}
      messages={messages}
      isLoading={isLoading}
      canStop={canStop}
      promptInputRef={promptInputRef}
      permissions={permissions}
      questions={questions}
      placeholder={hasMessages ? "Ask for a change, or paste an error…" : "Describe what to build or fix…"}
      onReplyPermission={replyPermission}
      onAnswerQuestion={answerQuestion}
      onAllowFolder={allowFolder}
      onStop={stop}
      onNewChat={onNewChat}
      onSummarize={summarizeAndContinue}
      onModeChange={onModeChange}
      onSubmit={submit}
      compact
    />
  );

  if (!root) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col px-4 pt-6 pb-4">
        <ChatModeNav mode="code" onModeChange={onModeChange} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
            <CodeXmlIcon className="size-7 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-medium">Code with Mali</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Open a project folder. You'll see the agent's edits live in the editor, run the build, and send any errors
              back for a fix — all in one place.
            </p>
          </div>
          <Button onClick={() => void pickFolder()} className="gap-2">
            <FolderOpenIcon className="size-4" />
            Open folder
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        {/* Toolbar: project · mode · run and view controls */}
        <div className="flex h-11 shrink-0 items-center gap-x-2 overflow-hidden border-b px-2">
          <div className="flex min-w-0 flex-1 basis-0 items-center gap-1 overflow-hidden">
          <ToolbarToggle on={explorerOpen} hint="Explorer" onClick={() => setExplorerOpen(!explorerOpen)}>
            <PanelLeftIcon className="size-4" />
          </ToolbarToggle>
          <button
            type="button"
            onClick={() => void pickFolder()}
            title={`${root}\n\nClick to open another folder${session?.cwd ? " (starts a new chat)" : ""}`}
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-muted"
          >
            <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-44 truncate">{folderName(root)}</span>
          </button>
          </div>

          <div className="flex min-w-0 flex-auto items-center justify-end gap-1 overflow-hidden">
            <ChatModeNav mode="code" onModeChange={onModeChange} className="hidden gap-1 lg:flex" />
            <span className="mx-1 hidden h-5 w-px shrink-0 bg-border lg:block" />
            <Popover
              open={commandMenuOpen}
              onOpenChange={(open) => {
                setCommandMenuOpen(open);
                if (!open) {
                  setCustomOpen(false);
                  setCustomDraft("");
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={
                    runner.selected
                      ? `${runner.selected.command}${runner.selected.cwd ? ` (in ${runner.selected.cwd})` : ""}`
                      : "Choose a build command"
                  }
                  className={cn(
                    "flex h-7 w-40 min-w-20 shrink items-center justify-between gap-1.5 rounded-md border bg-background px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-muted",
                    !runner.selected && "text-muted-foreground",
                  )}
                >
                  <span className="truncate">{runner.selected?.label ?? "Add a command…"}</span>
                  <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 gap-0 p-1">
                {customOpen ? (
                  <form
                    className="flex flex-col gap-2 p-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitCustomCommand();
                    }}
                  >
                    <p className="text-xs font-medium">Custom command</p>
                    <Input
                      autoFocus
                      value={customDraft}
                      onChange={(e) => setCustomDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setCustomOpen(false);
                          setCustomDraft("");
                        }
                      }}
                      placeholder="e.g. npm run build"
                      className="h-8 font-mono text-xs"
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCustomOpen(false);
                          setCustomDraft("");
                        }}
                      >
                        Back
                      </Button>
                      <Button type="submit" size="sm" disabled={!customDraft.trim()}>
                        Add
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col">
                    {runner.tasks.length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">No commands detected yet</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        {runner.tasks.map((task) => {
                          const active = task.id === runner.selected?.id;
                          return (
                            <button
                              key={task.id}
                              type="button"
                              title={`${task.command}${task.cwd ? ` (in ${task.cwd})` : ""}`}
                              onClick={() => {
                                runner.select(task.id);
                                setCommandMenuOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent",
                                active && "font-medium",
                              )}
                            >
                              <CheckIcon className={cn("size-3.5 shrink-0", !active && "invisible")} />
                              <span className="min-w-0 flex-1 truncate">{task.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomDraft("");
                        setCustomOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    >
                      <PlusIcon className="size-3.5 shrink-0" />
                      Custom command…
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <Button
              size="xs"
              variant={runner.running ? "outline" : "default"}
              className="shrink-0 gap-1.5"
              disabled={!runner.selected}
              onClick={runTask}
              title={runner.running ? "Stop" : "Save all and run (build / check)"}
            >
              {runner.running ? <SquareIcon className="size-3 fill-current" /> : <PlayIcon className="size-3 fill-current" />}
              {runner.running ? "Stop" : "Run"}
            </Button>
            <div className="mx-1 hidden shrink-0 xl:block">
              <RunStatus run={runner.run} />
            </div>
            <span className="mx-1 h-5 w-px shrink-0 bg-border" />
            <ToolbarToggle
              on={autoCheck}
              label="Auto-check"
              hint="Auto-check: run the selected command after every agent turn that changes files (skipped when the agent edits build config such as package.json)"
              onClick={() => setAutoCheck(!autoCheck)}
            >
              <ShieldCheckIcon className="size-4" />
            </ToolbarToggle>
            <ToolbarToggle
              on={autoFix}
              label="Auto-fix"
              hint={`Auto-fix: when the check fails, send the errors to the agent (up to ${MAX_AUTO_FIX} tries)`}
              onClick={() => {
                setAutoFix(!autoFix);
                if (!autoFix) setAutoCheck(true);
              }}
            >
              <WandSparklesIcon className="size-4" />
            </ToolbarToggle>
            <ToolbarToggle
              on={workspace.follow}
              label="Follow"
              hint="Follow the agent: open each file as it's being changed"
              onClick={() => workspace.setFollow(!workspace.follow)}
            >
              <CrosshairIcon className="size-4" />
            </ToolbarToggle>
            <span className="mx-1 h-5 w-px shrink-0 bg-border" />
            <ToolbarToggle on={bottomOpen} hint="Terminal & problems" onClick={() => setBottomOpen(!bottomOpen)}>
              <PanelBottomIcon className="size-4" />
            </ToolbarToggle>
            <ToolbarToggle on={chatOpen} hint="Chat & Git pane" onClick={() => setChatOpen(!chatOpen)}>
              <PanelRightIcon className="size-4" />
            </ToolbarToggle>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Explorer */}
          {explorerOpen && (
            <aside
              className="relative flex shrink-0 flex-col border-r"
              style={{ width: explorerWidth, maxWidth: "35%" }}
            >
              <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Explorer
                {isLoading && (
                  <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Live
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
                {workspace.scanError ? (
                  <p className="px-2 py-1 text-xs text-destructive">{workspace.scanError}</p>
                ) : !workspace.scanned ? (
                  <p className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                    <LoaderIcon className="size-3 animate-spin" /> Loading files…
                  </p>
                ) : (
                  <FileTree
                    root={root}
                    entries={workspace.entries}
                    active={workspace.active}
                    recent={workspace.recent}
                    dirty={dirty}
                    reviewing={reviewing}
                    onOpen={workspace.open}
                  />
                )}
                {workspace.truncated && (
                  <p className="px-2 py-1 text-[11px] text-muted-foreground">Large project: some files aren't listed.</p>
                )}
              </div>
              <div
                onPointerDown={dragExplorer}
                className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-ring/30"
              />
            </aside>
          )}

          {/* Editor + bottom panel */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {workspace.files.length > 0 && (
              <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b [scrollbar-width:none]">
                {workspace.files.map((file) => {
                  const isActive = file.rel === workspace.active;
                  const fresh = Date.now() - (workspace.recent[file.rel] ?? 0) < 4000;
                  return (
                    <motion.div
                      key={file.rel}
                      layout="position"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16 }}
                      className={cn(
                        "group relative flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r pr-1 pl-3 text-[13px] transition-colors",
                        isActive ? "bg-background text-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => workspace.setActive(file.rel)}
                      onAuxClick={(e) => e.button === 1 && workspace.close(file.rel)}
                      title={file.rel}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="code-active-tab"
                          className="absolute inset-x-0 top-0 h-0.5 bg-primary"
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                        />
                      )}
                      <FileTypeIcon name={file.rel} className={cn("size-3.5", fresh && "animate-pulse")} />
                      <span className={cn("truncate", file.deleted && "line-through")}>{fileName(file.rel)}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          workspace.close(file.rel);
                        }}
                        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
                        aria-label={`Close ${file.rel}`}
                      >
                        {isDirty(file) ? (
                          <span className="size-2 rounded-full bg-foreground/60 group-hover:hidden" />
                        ) : null}
                        <XIcon className={cn("size-3.5", isDirty(file) ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100")} />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {activeFile && (
              <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
                <FileTypeIcon name={activeFile.rel} className="size-3.5" />
                <span className="min-w-0 truncate font-mono">{activeFile.rel}</span>
                {isLoading && workspace.recent[activeFile.rel] && (
                  <span className="flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Agent editing
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <AnimatePresence>
                    {selection && (
                      <motion.div
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 6 }}
                        transition={{ duration: 0.14 }}
                        className="flex items-center gap-1"
                      >
                        <Button
                          size="xs"
                          variant="ghost"
                          className="gap-1"
                          onClick={() => addQuote(activeFile.rel, selection)}
                          title="Add the selected lines to the chat"
                        >
                          <QuoteIcon className="size-3" />
                          Add to chat
                          <kbd className="ml-0.5 font-sans text-[10px] text-muted-foreground">⌘L</kbd>
                        </Button>
                        {!readOnly && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => openInline(activeFile.rel, { ...selection, top: 4, bottom: 4 })}
                            title="Describe a change to these lines"
                          >
                            <SparklesIcon className="size-3" />
                            Edit
                            <kbd className="ml-0.5 font-sans text-[10px] text-muted-foreground">⌘K</kbd>
                          </Button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {readOnly && <span className="text-amber-600 dark:text-amber-400">Read-only</span>}
                  {isDirty(activeFile) && !readOnly && (
                    <Button size="xs" variant="ghost" className="gap-1" onClick={() => void workspace.save(activeFile.rel)}>
                      <SaveIcon className="size-3" />
                      Save
                    </Button>
                  )}
                  {isMarkdownRel(activeFile.rel) && (
                    <Button
                      size="xs"
                      variant={mdPreview ? "secondary" : "outline"}
                      className="ml-0.5 shrink-0 gap-1 px-2"
                      onClick={() => setMdPreview((on) => !on)}
                      title={
                        mdPreview
                          ? reviewingActive
                            ? "Show git diff"
                            : "Show markdown source"
                          : "Preview rendered markdown"
                      }
                    >
                      <EyeIcon className="size-3" />
                      Preview
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!grant && (
              <Banner tone="warning">
                Mali doesn't have access to this folder yet.
                <Button size="xs" variant="outline" onClick={() => root && void requestFolderAccess(root)}>
                  Allow access…
                </Button>
              </Banner>
            )}
            {skipped && (
              <Banner tone="warning">
                {skipped}
                <button type="button" className="ml-auto" onClick={() => setSkipped(undefined)} aria-label="Dismiss">
                  <XIcon className="size-3.5" />
                </button>
              </Banner>
            )}
            {activeFile?.conflict && (
              <Banner tone="warning">
                The agent changed this file while you were editing it.
                <Button size="xs" variant="outline" onClick={() => void workspace.reload(activeFile.rel)}>
                  Use the agent's version
                </Button>
                <Button size="xs" variant="ghost" onClick={() => void workspace.save(activeFile.rel, true)}>
                  Keep mine
                </Button>
              </Banner>
            )}
            {activeFile?.deleted && !activeFile.conflict && (
              <Banner tone="warning">
                This file was deleted on disk.
                <Button size="xs" variant="outline" onClick={() => void workspace.save(activeFile.rel, true)}>
                  Save it again
                </Button>
                <Button size="xs" variant="ghost" onClick={() => workspace.close(activeFile.rel)}>
                  Close
                </Button>
              </Banner>
            )}
            {activeFile?.error && activeFile.status === "ready" && <Banner tone="error">{activeFile.error}</Banner>}

            <div ref={editorBoxRef} className="relative min-h-0 flex-1 overflow-hidden">
              {!activeFile ? (
                <EmptyEditor
                  running={isLoading}
                  hasProblems={problems.length > 0}
                  recent={Object.entries(workspace.recent)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([rel]) => rel)}
                  onOpen={workspace.open}
                />
              ) : activeFile.status === "loading" ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <LoaderIcon className="mr-2 size-4 animate-spin" /> Opening…
                </div>
              ) : activeFile.status !== "ready" ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
                  <CircleAlertIcon className="size-5" />
                  {activeFile.status === "binary"
                    ? "This is a binary file."
                    : activeFile.status === "too-large"
                      ? "This file is too large to edit here (over 2 MB)."
                      : (activeFile.error ?? "Can't open this file.")}
                </div>
              ) : mdPreview && isMarkdownRel(activeFile.rel) ? (
                <MarkdownFilePreview key={`preview:${activeFile.rel}`} text={activeFile.text} />
              ) : reviewingActive && review.current && review.checkpointId ? (
                <TurnReviewDiff
                  key={`review:${review.current.path}`}
                  checkpointId={review.checkpointId}
                  path={review.current.path}
                  rel={activeFile.rel}
                />
              ) : (
                <CodeEditor
                  key={activeFile.rel}
                  rel={activeFile.rel}
                  value={activeFile.text}
                  readOnly={readOnly}
                  flash={activeFile.flash}
                  problems={problemsByFile.get(activeFile.rel) ?? []}
                  reveal={reveal?.rel === activeFile.rel ? reveal : undefined}
                  onChange={(text) => workspace.edit(activeFile.rel, text)}
                  onSave={() => !readOnly && void workspace.save(activeFile.rel)}
                  onSelection={setSelection}
                  onAddToChat={(lines) => addQuote(activeFile.rel, lines)}
                  onInlineEdit={readOnly ? undefined : (anchor) => openInline(activeFile.rel, anchor)}
                />
              )}
              <AnimatePresence>
                {inline && inline.rel === activeFile?.rel && (
                  <InlineEdit
                    key={`${inline.rel}:${inline.anchor.from}:${inline.anchor.to}`}
                    rel={inline.rel}
                    anchor={inline.anchor}
                    containerHeight={editorBoxRef.current?.clientHeight ?? 600}
                    busy={inline.busy}
                    blocked={isLoading && !inline.busy}
                    onSubmit={(instruction) => void submitInline(instruction)}
                    onStop={stop}
                    onClose={() => setInline(undefined)}
                  />
                )}
              </AnimatePresence>
              <ReviewBar review={review} />
            </div>

            {bottomOpen && (
              <div className="relative shrink-0 border-t" style={{ height: bottomHeight }}>
                <div
                  onPointerDown={dragBottom}
                  className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize hover:bg-ring/30"
                />
                <RunPanel
                  run={runner.run}
                  canFix={!isLoading}
                  onFix={() => void askToFix()}
                  onOpenProblem={openProblem}
                />
              </div>
            )}
          </main>
        </div>

        {/* Right pane: the chat, or Git in the same place (never a third column) */}
        {chatOpen && (
          <section
            className="relative flex min-h-0 min-w-0 shrink-0 flex-col self-stretch overflow-hidden border-l"
            style={{ width: chatWidth, maxWidth: "60%" }}
          >
            <div
              onPointerDown={dragChat}
              className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize hover:bg-ring/30"
            />
            {withGit && git && (
              <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
                <PaneTab active={!gitOpen} onClick={git.closePanel}>
                  <MessageSquareIcon className="size-3.5" />
                  Chat
                  {isLoading && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
                </PaneTab>
                <PaneTab active={gitOpen} onClick={() => git.openPanel()} title="Git (⇧⌘G)">
                  <GitBranchIcon className="size-3.5" />
                  Git
                  {git.status?.branch.head && (
                    <span className="max-w-28 truncate font-mono text-[11px] text-muted-foreground">
                      {git.status.branch.head}
                    </span>
                  )}
                  {git.changes.length > 0 && (
                    <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                      {git.changes.length}
                    </span>
                  )}
                </PaneTab>
                {git.busy && (
                  <span className="ml-auto flex min-w-0 items-center gap-1.5 truncate px-1 text-xs text-muted-foreground">
                    <LoaderIcon className="size-3 shrink-0 animate-spin" />
                    <span className="truncate">{git.busy}</span>
                  </span>
                )}
              </div>
            )}

            {gitOpen && <GitPanel embedded />}

            {/* Kept mounted under Git, so a draft or a permission prompt isn't lost. */}
            <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", gitOpen && "hidden")}>
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-3">
                {!hasMessages && (
                  <CodeIntro
                    onPick={(prompt) => {
                      void workspace.saveAll().then(() => sendText(prompt, editorContext()));
                    }}
                    hasFile={!!activeFile}
                  />
                )}
                <CodeChatContext.Provider value={codeChat}>
                <ChatMessagePanel
                  messages={messages}
                  isLoading={isLoading}
                  containerRef={containerRef}
                  atBottom={atBottom}
                  onScrollToBottom={scrollToBottom}
                  session={session}
                  project={project}
                  continuedFrom={session?.continuedFrom}
                  onRetry={(id) => void retryMessage(id)}
                  onEdit={(id, text) => void editAndResend(id, text)}
                  onRate={rateMessage}
                  className={cn(
                    hasMessages
                      ? "min-h-0 flex-1 overflow-hidden"
                      : "pointer-events-none absolute h-px w-px overflow-hidden opacity-0",
                  )}
                />
                </CodeChatContext.Provider>
              </div>
              <div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-2 pb-4 [&>*]:min-w-0">
                <AnimatePresence initial={false}>
                  {quotes.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.16 }}
                      className="flex flex-wrap gap-1.5 overflow-hidden"
                    >
                      {quotes.map((quote, index) => (
                        <motion.span
                          key={`${quote.rel}:${quote.from}:${quote.to}`}
                          layout
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 py-1 pr-1 pl-2 text-xs"
                          title={quote.text}
                        >
                          <FileTypeIcon name={quote.rel} className="size-3.5" />
                          <span className="min-w-0 truncate font-mono">
                            {fileName(quote.rel)}
                            <span className="text-muted-foreground">
                              :{quote.from}
                              {quote.to !== quote.from ? `–${quote.to}` : ""}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setQuotes((prev) => prev.filter((_, i) => i !== index))}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Remove from chat"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </motion.span>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                {composer}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PaneTab({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Banner({ tone, children }: { tone: "warning" | "error"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs",
        tone === "warning"
          ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

function EmptyEditor({
  running,
  hasProblems,
  recent,
  onOpen,
}: {
  running: boolean;
  hasProblems: boolean;
  recent: string[];
  onOpen: (rel: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <CodeXmlIcon className="size-8 text-muted-foreground/60" />
      <p className="max-w-sm text-sm text-muted-foreground">
        {running
          ? "The agent is working — files open here as it changes them."
          : hasProblems
            ? "Pick a problem below to jump to it, or ask the agent to fix it."
            : "Open a file from the explorer, or ask the agent to build something."}
      </p>
      {recent.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-[11px] tracking-wide text-muted-foreground uppercase">Just changed</span>
          {recent.map((rel) => (
            <button
              key={rel}
              type="button"
              onClick={() => onOpen(rel)}
              className="font-mono text-xs text-foreground/80 hover:underline"
            >
              {rel}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/80">
        <span>
          <kbd className="font-sans">⌘L</kbd> add to chat
        </span>
        <span>
          <kbd className="font-sans">⌘K</kbd> edit inline
        </span>
        <span>
          <kbd className="font-sans">⌘S</kbd> save
        </span>
      </div>
    </div>
  );
}

const STARTERS = [
  { label: "Explain this project", prompt: "Give me a quick tour of this project: what it does, how it's structured, and how to run it." },
  { label: "Find & fix bugs", prompt: "Look through this project for real bugs (not style), fix the most important ones, and tell me what you changed." },
  { label: "Make the build pass", prompt: "Run the project's build / type check, then fix every error until it passes." },
];

function CodeIntro({ onPick, hasFile }: { onPick: (prompt: string) => void; hasFile: boolean }) {
  const starters = hasFile
    ? [
        ...STARTERS,
        {
          label: "Write tests for the open file",
          prompt: "Write focused tests for the file I have open, following the project's existing test setup, and run them.",
        },
      ]
    : STARTERS;
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 pb-4">
      <div className="space-y-1 px-1">
        <h2 className="text-lg font-medium">What should we build?</h2>
        <p className="text-sm text-muted-foreground">
          The agent edits files in this folder. You'll see each change land in the editor as it happens.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {starters.map((starter) => (
          <button
            key={starter.label}
            type="button"
            onClick={() => onPick(starter.prompt)}
            className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
          >
            {starter.label}
          </button>
        ))}
      </div>
    </div>
  );
}
