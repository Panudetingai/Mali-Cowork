/**
 * Root of the Quick bar window (`index.html?window=quick`), opened by the
 * global shortcut over any app: ask, or run a one-tap action on the
 * clipboard, then copy the answer or continue it in Mali.
 */
import { MessageResponse } from "@/components/ai-elements/message";
import { MarkdownSurface } from "@/components/chat/markdown-surface";
import { Kbd } from "@/components/ui/kbd";
import type { Attachment } from "@/features/attachments";
import { cn } from "@/lib/utils";
import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { OPENCODE_DEFAULT_ID } from "@/pages/chat/models";
import {
  ArrowUpIcon,
  CheckIcon,
  ClipboardIcon,
  CopyIcon,
  ExternalLinkIcon,
  ImageIcon,
  LoaderIcon,
  ScanIcon,
  SettingsIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DEFAULT_QUICK_ACTIONS } from "./actions";
import {
  captureScreen,
  hideQuick,
  onQuickOpened,
  startCaptureOverlay,
  takeQuickContext,
} from "./api";
import {
  onQuickCaptureDone,
  openQuickSettings,
  requestQuickTheme,
  saveQuickThread,
} from "./bridge";
import {
  describeQuickModel,
  quickModelId,
  runQuickPrompt,
  type QuickModelInfo,
  type QuickThread,
} from "./run";
import { getQuickConfig, reloadQuickConfig, useQuickConfig } from "./settings";
import type {
  QuickAction,
  QuickContext,
  QuickRequest,
  QuickTurn,
} from "./types";

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const isWindows =
  typeof navigator !== "undefined" && /Win/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/** Until the real name loads: `opencode:anthropic/claude-sonnet-5` → `claude-sonnet-5`. */
const shortModel = (id: string) =>
  id === OPENCODE_DEFAULT_ID ? "Auto" : id.split(/[:/]/).pop() || id;

export function QuickBarRoot() {
  const { setTheme } = useTheme();
  const [context, setContext] = useState<QuickContext>();
  const [clipboard, setClipboard] = useState<string>();
  const [shots, setShots] = useState<Attachment[]>([]);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<QuickTurn[]>([]);
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [modelInfo, setModelInfo] = useState<QuickModelInfo>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const threadRef = useRef<QuickThread>({ history: [] });

  const streaming = turns.at(-1)?.status === "streaming";
  const last = turns.at(-1);
  useQuickConfig(); // re-render when Settings change the model
  const modelId = quickModelId();

  // Each shortcut press starts fresh, unless an answer is still coming.
  const reset = useCallback((next: QuickContext) => {
    // Settings may have changed in the main window since the bar last opened.
    reloadQuickConfig();
    void describeQuickModel()
      .then(setModelInfo)
      .catch(() => undefined);
    setContext(next);
    setClipboard(next.clipboardText);
    setShots([]);
    setInput("");
    setTurns([]);
    setNote(undefined);
    setCopied(false);
    setChatId(crypto.randomUUID());
    threadRef.current = { history: [] };
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const load = () => {
      if (abortRef.current && !abortRef.current.signal.aborted) {
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      void takeQuickContext().then(reset);
    };
    load();
    const unlisten = onQuickOpened(load);
    const stopTheme = requestQuickTheme((theme) => setTheme(theme));
    return () => {
      void unlisten.then((stop) => stop());
      stopTheme();
    };
  }, [reset, setTheme]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    const stop = onQuickCaptureDone((attachment) => {
      setShots((prev) => [...prev, attachment]);
      setNote(undefined);
    });
    return () => stop();
  }, []);

  const updateLast = (fn: (turn: QuickTurn) => QuickTurn) =>
    setTurns((prev) =>
      prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev,
    );

  const send = async (action?: QuickAction) => {
    if (streaming) return;
    const typed = input.trim();
    const request: QuickRequest = {
      prompt: typed,
      action,
      // The clipboard belongs to the first question; follow-ups build on the thread.
      clipboardText: turns.length === 0 ? clipboard : undefined,
      attachments: shots,
    };
    if (!typed && !action && shots.length === 0 && !request.clipboardText)
      return;
    const turn: QuickTurn = {
      id: crypto.randomUUID(),
      display: typed || action?.label || "ถามเกี่ยวกับข้อความนี้",
      request,
      answer: "",
      status: "streaming",
      modelId,
    };
    setTurns((prev) => [...prev, turn]);
    setInput("");
    setShots([]);
    setNote(undefined);
    setCopied(false);

    const controller = new AbortController();
    abortRef.current = controller;
    const { sessionId } = await runQuickPrompt(
      request,
      (event) => {
        if (event.type === "text")
          updateLast((t) => ({ ...t, answer: t.answer + event.delta }));
        else if (event.type === "done")
          updateLast((t) => ({ ...t, status: "done" }));
        else
          updateLast((t) => ({
            ...t,
            status: "error",
            error: event.message,
            errorFix: event.fix,
          }));
      },
      { signal: controller.signal, thread: threadRef.current },
    );
    if (controller.signal.aborted)
      updateLast((t) =>
        t.status === "streaming" ? { ...t, status: "stopped" } : t,
      );
    controller.abort();
    threadRef.current = { sessionId, history: threadRef.current.history };
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Record finished exchanges for providers without a session, and hand the
  // thread to the main window when history is on.
  useEffect(() => {
    const done = turns.filter((t) => t.status === "done");
    if (done.length === 0 || streaming) return;
    threadRef.current.history = done.flatMap((t) => [
      {
        role: "user" as const,
        content:
          t.display +
          (t.request.clipboardText ? `\n\n${t.request.clipboardText}` : ""),
      },
      { role: "assistant" as const, content: t.answer },
    ]);
    if (getQuickConfig().saveToHistory)
      void saveQuickThread({ chatId, turns: done, open: false });
  }, [turns, streaming, chatId]);

  const stop = () => abortRef.current?.abort();

  const copyAnswer = async () => {
    if (!last?.answer) return;
    try {
      await navigator.clipboard.writeText(last.answer);
      setCopied(true);
      setTimeout(() => void hideQuick(), 350);
    } catch {
      setNote("คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วกด ⌘C");
    }
  };

  const openInMali = () => {
    const done = turns.filter((t) => t.status === "done");
    if (done.length === 0) return;
    void saveQuickThread({ chatId, turns: done, open: true });
  };

  const capture = async () => {
    setCapturing(true);
    setNote(undefined);
    try {
      if (isMac) {
        const shot = await captureScreen();
        if (shot) setShots((prev) => [...prev, shot]);
      } else if (isWindows) {
        await startCaptureOverlay();
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setCapturing(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      if (streaming) stop();
      else void hideQuick();
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      // Thai input methods compose with Enter; only a finished line sends.
      if (event.target === inputRef.current) {
        event.preventDefault();
        void send();
      }
    } else if (mod && /^[1-9]$/.test(event.key)) {
      const action = DEFAULT_QUICK_ACTIONS[Number(event.key) - 1];
      if (action) {
        event.preventDefault();
        void send(action);
      }
    } else if (mod && event.key.toLowerCase() === "o") {
      event.preventDefault();
      openInMali();
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyAnswer();
    }
  };

  const hasThread = turns.length > 0;
  const canOpen = turns.some((t) => t.status === "done") && !streaming;

  return (
    // The card is the window's shape (transparent on macOS) and the system
    // draws the shadow around it, like the main window.
    <div className="h-screen">
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden bg-background text-sm text-foreground",
          // A hairline keeps the edge crisp over any backdrop.
          "rounded-[var(--window-radius)]",
        )}
        onKeyDown={onKeyDown}
      >
        {/* Title bar doubles as the drag handle. */}
        <div
          data-tauri-drag-region
          className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3"
        >
          <img
            src="/icon-transparent.png"
            alt=""
            className="pointer-events-none size-3.5 shrink-0"
          />
          <span data-tauri-drag-region className="text-xs font-medium">
            Mali Quick
          </span>
          <span
            data-tauri-drag-region
            className="ml-auto flex min-w-0 items-center gap-1.5 rounded-full bg-muted/60 py-0.5 pr-2 pl-1.5 text-[11px] text-muted-foreground"
            title={modelId}
          >
            {modelInfo?.id === modelId && (
              <ModelSelectorLogo
                provider={modelInfo.provider}
                className="pointer-events-none size-3.5 shrink-0"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
            <span
              data-tauri-drag-region
              className="truncate text-foreground/80"
            >
              {modelInfo?.id === modelId
                ? modelInfo.auto
                  ? `Auto · ${modelInfo.name}`
                  : modelInfo.name
                : shortModel(modelId)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void hideQuick()}
            className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        {/* The thread; empty until the first question. */}
        <div
          ref={scrollRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4",
            hasThread ? "py-3" : "hidden",
          )}
        >
          <div className="flex flex-col gap-4">
            {turns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-2">
                <div className="self-end rounded-xl bg-muted px-3 py-1.5 text-xs">
                  {turn.display}
                  {turn.request.clipboardText && (
                    <span className="ml-1.5 text-muted-foreground">
                      + clipboard
                    </span>
                  )}
                </div>
                {turn.answer ? (
                  <MarkdownSurface>
                    <MessageResponse
                      className="text-sm"
                      isAnimating={turn.status === "streaming"}
                    >
                      {turn.answer}
                    </MessageResponse>
                  </MarkdownSurface>
                ) : turn.status === "streaming" ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <LoaderIcon className="size-3.5 animate-spin" /> กำลังคิด…
                  </div>
                ) : null}
                {turn.status === "error" && (
                  <div className="flex flex-col items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    <p>{turn.error}</p>
                    {turn.errorFix === "pick-model" && (
                      <button
                        type="button"
                        onClick={() => void openQuickSettings()}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-500/30 bg-background px-2.5 text-xs text-foreground hover:bg-muted"
                      >
                        <SettingsIcon className="size-3.5" />
                        เลือกโมเดลอื่น
                      </button>
                    )}
                  </div>
                )}
                {turn.status === "stopped" && (
                  <p className="text-xs text-muted-foreground">หยุดแล้ว</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Composer. */}
        <div
          className={cn(
            "flex shrink-0 flex-col gap-2 px-3 py-3",
            hasThread ? "border-t border-border/60" : "flex-1",
          )}
        >
          {(clipboard && turns.length === 0) || shots.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {clipboard && turns.length === 0 && (
                <Chip
                  icon={<ClipboardIcon className="size-3.5 shrink-0" />}
                  label={clipboard.trim().split("\n")[0]}
                  badge={context?.clipboardTruncated ? "ถูกตัด" : undefined}
                  title={clipboard}
                  onRemove={() => setClipboard(undefined)}
                />
              )}
              {shots.map((shot) => (
                <Chip
                  key={shot.id}
                  icon={<ImageIcon className="size-3.5 shrink-0" />}
                  label={shot.name}
                  onRemove={() =>
                    setShots((prev) => prev.filter((s) => s.id !== shot.id))
                  }
                />
              ))}
            </div>
          ) : null}

          <textarea
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={hasThread ? 1 : 3}
            placeholder={
              hasThread
                ? "ถามต่อ…"
                : clipboard
                  ? "ถามเกี่ยวกับข้อความที่ copy ไว้ หรือเลือก action ด้านล่าง"
                  : "ถามอะไรก็ได้…"
            }
            className={cn(
              "w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground",
              !hasThread && "flex-1",
            )}
          />

          <div className="flex items-center gap-1.5">
            {!hasThread &&
              DEFAULT_QUICK_ACTIONS.map((action, i) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={streaming}
                  onClick={() => void send(action)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {action.label}
                  <Kbd className="h-4 min-w-4 bg-transparent px-0 text-[10px]">
                    {MOD}
                    {i + 1}
                  </Kbd>
                </button>
              ))}

            {hasThread && (
              <>
                <FooterButton
                  onClick={() => void copyAnswer()}
                  disabled={!last?.answer || streaming}
                >
                  {copied ? (
                    <CheckIcon className="size-3.5" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                  {copied ? "คัดลอกแล้ว" : "Copy"}
                </FooterButton>
                <FooterButton onClick={openInMali} disabled={!canOpen}>
                  <ExternalLinkIcon className="size-3.5" />
                  Open in Mali
                  <Kbd className="h-4 bg-transparent px-0 text-[10px]">
                    {MOD}O
                  </Kbd>
                </FooterButton>
              </>
            )}

            <div className="ml-auto flex items-center gap-1">
              {(isMac || isWindows) && (
                <button
                  type="button"
                  onClick={() => void capture()}
                  disabled={capturing || streaming}
                  title="Capture screen"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {capturing ? (
                    <LoaderIcon className="size-4 animate-spin" />
                  ) : (
                    <ScanIcon className="size-4" />
                  )}
                </button>
              )}
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  title="Stop (Esc)"
                  className="flex size-7 items-center justify-center rounded-full bg-foreground text-background"
                >
                  <SquareIcon className="size-3 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    !input.trim() &&
                    !(clipboard && turns.length === 0) &&
                    shots.length === 0
                  }
                  title="Send (Enter)"
                  className="flex size-7 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30"
                >
                  <ArrowUpIcon className="size-4" />
                </button>
              )}
            </div>
          </div>

          {note && (
            <p className="text-xs text-red-600 dark:text-red-400">{note}</p>
          )}
          {!hasThread && (
            <p className="text-[11px] text-muted-foreground">
              Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · Esc ปิด
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  icon,
  label,
  badge,
  title,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 py-1 pr-1 pl-2 text-xs text-muted-foreground"
    >
      {icon}
      <span className="max-w-[420px] truncate text-foreground">{label}</span>
      {badge && (
        <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-600 dark:text-amber-400">
          {badge}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 hover:bg-muted"
        aria-label="Remove"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

function FooterButton({ children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-xs hover:bg-muted disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
