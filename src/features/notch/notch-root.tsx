/**
 * The notch pill window (`?window=notch`). It loads no history: the main
 * window sends what to show (`relay.ts`) and gets Allow / Deny back; asking
 * in the notch runs here, on the Quick bar's engine (`useNotchChat`).
 *
 * The page owns the pill's shape. The window grows before the shape does and
 * shrinks after it settles, so the spring plays out in full and the empty
 * part of the window never sits over the user's screen for long.
 *
 * In notch mode the pill stays up with nothing running: the cursor at the
 * top of the screen (watched from Rust, so it works while Mali is in the
 * background) opens Home, ⌥⌘M the ask box.
 */
import { BOTS, useCoworkBot, type BotState } from "@/features/cowork-bot";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import {
  captureAtCursor,
  capturePick,
  exitNotchMode,
  getNotchMode,
  openTeamInApp,
  hideNotch,
  listenForNotchGeometry,
  listenForNotchState,
  onNotchHover,
  onNotchIntro,
  onNotchDrag,
  onNotchMode,
  onNotchSummon,
  openMainFromNotch,
  resizeNotch,
  sendNotchReply,
  setNotchHitArea,
  takeNotchIntro,
  type NotchCapture,
  type NotchPoint,
} from "./bridge";
import { hitArea, pillWindow, shapeSize } from "./layout";
import { setNotchFolder, useNotchFolder } from "./folders";
import { NotchChat, type ChatPanel } from "./notch-chat";
import { NotchIntro } from "./notch-intro";
import { NotchPill, type ActiveBot } from "./notch-pill";
import { useTeamRoster } from "./team";
import type { NotchGeometry, NotchSnapshot, NotchView } from "./types";
import { setNotchModelId, useNotchModelId } from "./settings";
import { useNotchChat } from "./use-notch-chat";
import { useNotchCowork } from "./use-notch-cowork";

const NO_GEOMETRY: NotchGeometry = { hasNotch: false, notchWidth: 0, barHeight: 0 };
/** Hover opens the pill after a beat, so passing the mouse over doesn't. */
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 380;
/** A single click waits this long in case it's the start of a double-click. */
const CLICK_DELAY_MS = 220;
/** The welcome: thinking this long, then waiting for work; it closes after the rest. */
const WAKE_MS = 1800;
const WELCOME_MS = 4600;
/** Long enough for a web view's resize to draw (it's blank meanwhile). */
const RESIZE_SETTLE_MS = 350;
/** "Got it!" after a drop, before the ask box takes over. */
const CATCH_MS = 700;

/** Notch mode with nothing running: the bot on its wing, ready to ask. */
const IDLE: NotchSnapshot = {
  phase: "idle",
  chatId: "",
  title: "",
  steps: [],
  todos: [],
  team: [],
  waiting: 0,
  running: 0,
};

type Open = "home" | "chat" | "welcome" | null;

export function NotchRoot() {
  const [snapshot, setSnapshot] = useState<NotchSnapshot | null>(null);
  const [geometry, setGeometry] = useState<NotchGeometry>(NO_GEOMETRY);
  const [mode, setMode] = useState(false);
  const [booted, setBooted] = useState(false);
  const [intro, setIntro] = useState<NotchPoint | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [drop, setDrop] = useState<"over" | "taken">();
  /** Rust saw files dragged near the top: keep the drop zone open until the drag moves off. */
  const dragNear = useRef(false);
  /** The drag over the pill carries files. */
  const fileDrag = useRef(false);
  const [capturing, setCapturing] = useState(false);
  /** What the last capture was of, for the ask box to say. */
  const [captured, setCaptured] = useState<NotchCapture>();
  const [welcomeState, setWelcomeState] = useState<BotState>("thinking");
  const [input, setInput] = useState("");
  const [botId, setBotId] = useState<string>();
  /** A model picked for this conversation with a team bot; Mali's pick is kept in settings. */
  const [threadModel, setThreadModel] = useState<string>();
  const [panel, setPanel] = useState<ChatPanel>(null);
  const folder = useNotchFolder();
  const notchModel = useNotchModelId();
  const [answered, setAnswered] = useState<{ id: string; reply: "once" | "reject" }>();
  const { bot: lead } = useCoworkBot();
  const roster = useTeamRoster();
  const chat = useNotchChat();
  const cowork = useNotchCowork(snapshot);
  const inputRef = useRef<HTMLInputElement>(null);
  const hovered = useRef(false);

  useEffect(() => listenForNotchState(setSnapshot), []);
  useEffect(() => listenForNotchGeometry(setGeometry), []);

  // Whether we're in notch mode, and a fly-in to play, before the first resize.
  useEffect(() => {
    if (!isTauri()) return setBooted(true);
    void Promise.all([getNotchMode(), takeNotchIntro()])
      .then(([on, from]) => {
        setMode(on);
        if (from) setIntro(from);
      })
      .catch(() => undefined)
      .finally(() => setBooted(true));
    const stopMode = onNotchMode((on) => {
      setMode(on);
      if (!on) setOpen(null);
    });
    const stopIntro = onNotchIntro(() => {
      void takeNotchIntro().then((from) => {
        if (!from) return;
        setIntro(from);
      });
    });
    return () => {
      stopMode();
      stopIntro();
    };
  }, []);

  const shown = snapshot ?? (mode ? IDLE : null);
  const phase = shown?.phase;
  const permission = phase === "permission" ? shown?.permission : undefined;
  const view: NotchView = permission ? "permission" : drop ? "drop" : (open ?? "collapsed");

  // ── who's in the main spot ──
  const leadName = BOTS.find((b) => b.id === lead)?.name ?? "Mali";
  const picked = roster.find((b) => b.id === botId);
  const working = snapshot?.team.filter((m) => !m.done).at(-1);
  const active: ActiveBot = shown?.asker
    ? { key: shown.asker.id, bot: shown.asker.mascot, name: shown.asker.name }
    : view === "chat" && picked
      ? { key: picked.id, bot: picked.mascot, name: picked.name }
      : working && phase === "working"
        ? { key: working.id, bot: working.mascot, name: working.name }
        : { key: "lead", bot: lead, name: leadName };

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 140);

  // ── window size ──
  // The model and folder lists leave with the ask box.
  useEffect(() => {
    if (view !== "chat") setPanel(null);
  }, [view]);

  const thread = folder ? cowork.turns.length > 0 : chat.turns.length > 0;
  const shape = shapeSize(view, geometry, {
    thread: thread || !!panel,
    files: chat.files.length > 0 || chat.importing > 0,
  });
  // One window size for every view (it changes only with the screen); the
  // pill animates inside it, and only its own area takes clicks.
  const frame = pillWindow(geometry);
  const focusable = view === "permission" || view === "chat";
  const sizing = booted && !intro && !!shown;
  useEffect(() => {
    if (!sizing) return;
    void resizeNotch(frame.width, frame.height, focusable).catch(() => undefined);
  }, [sizing, frame.width, frame.height, focusable]);
  const area = hitArea(frame, shape);
  useEffect(() => {
    if (!sizing) return;
    void setNotchHitArea(area).catch(() => undefined);
  }, [sizing, area.x, area.y, area.width, area.height]);

  // ── opening and closing ──
  const sticky = () =>
    open === "chat" &&
    (!!panel ||
      cowork.running ||
      !!input.trim() ||
      chat.files.length > 0 ||
      (document.hasFocus() && document.activeElement === inputRef.current));
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current);
      clearTimeout(pressTimer.current);
    },
    [],
  );

  const enter = () => {
    hovered.current = true;
    clearTimeout(hoverTimer.current);
    if (view === "collapsed") hoverTimer.current = setTimeout(() => setOpen("home"), OPEN_DELAY_MS);
  };
  const leave = () => {
    hovered.current = false;
    clearTimeout(hoverTimer.current);
    if (open && !sticky()) hoverTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  };
  const enterRef = useRef(enter);
  enterRef.current = enter;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  // The page can't see the mouse while Mali is in the background; Rust can.
  useEffect(() => onNotchHover((inside) => (inside ? enterRef.current() : leaveRef.current())), []);

  const openChat = () => {
    setOpen("chat");
    focusInput();
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  // ⌥⌘M: open the ask box ready to type, or close it if it's open and in use.
  useEffect(
    () =>
      onNotchSummon(() => {
        if (viewRef.current === "chat" && document.hasFocus()) return setOpen(null);
        setOpen("chat");
        setTimeout(() => inputRef.current?.focus(), 140);
      }),
    [],
  );

  // Clicking away closes the ask box; what was asked stays for next time.
  useEffect(() => {
    const onBlur = () => setOpen((o) => (o === "chat" ? null : o));
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // Files dragged onto the pill: it opens into a drop zone, catches them,
  // then the ask box takes them.
  const addFiles = chat.addFiles;
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        // Only a drag that carries files (the bot's own drag carries none).
        if (payload.type === "enter") fileDrag.current = payload.paths.length > 0;
        if ((payload.type === "enter" || payload.type === "over") && !fileDrag.current) return;
        if (payload.type === "enter" || payload.type === "over") setDrop((d) => d ?? "over");
        // Leaving the pill while still dragging near the top keeps the zone open.
        else if (payload.type === "leave") setDrop((d) => (d === "over" && dragNear.current ? d : undefined));
        else if (payload.type === "drop") {
          if (!payload.paths.length) return setDrop(undefined);
          setDrop("taken");
          void addFiles(payload.paths);
          setTimeout(() => {
            setDrop(undefined);
            setOpen("chat");
            setTimeout(() => inputRef.current?.focus(), 140);
          }, CATCH_MS);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addFiles]);

  // Files dragged toward the top open the drop zone before they reach the
  // edge (where macOS would open Mission Control instead).
  useEffect(
    () =>
      onNotchDrag((near) => {
        dragNear.current = near;
        setDrop((d) => (near ? (d ?? "over") : d === "over" ? undefined : d));
      }),
    [],
  );

  // ── capture ──
  const takeCapture = async (take: () => Promise<NotchCapture | null>) => {
    if (capturing) return;
    setCapturing(true);
    try {
      const capture = await take();
      if (!capture) return;
      chat.attach(capture.attachment);
      setCaptured(capture);
      setOpen("chat");
      setTimeout(() => inputRef.current?.focus(), 140);
    } catch (error) {
      chat.setNote(error instanceof Error ? error.message : String(error));
      setOpen("chat");
    } finally {
      setCapturing(false);
    }
  };

  // ── replies ──
  const answering = permission && answered?.id === permission.id ? answered.reply : undefined;
  const reply = (choice: "once" | "reject") => {
    if (!shown || !permission || answering) return;
    setAnswered({ id: permission.id, reply: choice });
    void sendNotchReply({ chatId: shown.chatId, id: permission.id, reply: choice }).catch(() =>
      setAnswered(undefined),
    );
  };
  const replyRef = useRef(reply);
  replyRef.current = reply;

  // Y allows, N or Esc denies — only while an approval is on the pill.
  useEffect(() => {
    if (!permission) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "y") replyRef.current("once");
      else if (key === "n" || key === "escape") replyRef.current("reject");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [permission]);

  const color = BOTS.find((b) => b.id === lead)?.color ?? "#3aa3f5";
  if (intro) {
    return (
      <NotchIntro
        from={intro}
        color={color}
        onDone={() => {
          // Back from the fly-in's full-screen window to the pill's: let that
          // one resize land before the welcome opens, so it isn't caught blank.
          setIntro(null);
          setTimeout(() => {
            // The pill opens on the welcome: the bot thinks, then waits for work.
            setWelcomeState("thinking");
            setOpen("welcome");
            setTimeout(() => setWelcomeState("idle"), WAKE_MS);
            setTimeout(() => {
              if (!hovered.current) setOpen((o) => (o === "welcome" ? null : o));
            }, WELCOME_MS);
          }, RESIZE_SETTLE_MS);
        }}
      />
    );
  }
  if (!shown) return null;

  const openChatInApp = (id?: string) =>
    void (mode ? exitNotchMode(id) : openMainFromNotch(id)).catch(() => undefined);
  const openRunChat = () =>
    openChatInApp(view === "chat" ? (folder ? cowork.chatId : chat.savedChatId()) : shown.chatId || undefined);
  const press = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      // A finished run (outside notch mode) opens its chat; otherwise the pill opens.
      if (phase === "done" && !mode) openRunChat();
      else setOpen("home");
    }, CLICK_DELAY_MS);
  };
  const dismiss = () => {
    clearTimeout(pressTimer.current);
    clearTimeout(hoverTimer.current);
    setOpen(null);
    void hideNotch().catch(() => undefined);
  };
  /** Ask a team bot directly: a fresh question to it, with it in the main spot. */
  const pickBot = (id: string) => {
    if (id !== botId && chat.turns.length) chat.reset();
    if (id !== botId) setThreadModel(undefined);
    setBotId(id);
    openChat();
  };
  // A team bot answers on its own model unless one is picked for it here;
  // Mali answers on the notch's pick, else the Quick bar's.
  const modelId = threadModel ?? (picked ? undefined : (notchModel ?? undefined));
  const pickedModel = threadModel ?? (picked ? picked.modelId || null : notchModel);
  const pickModel = (id: string | null) => {
    if (picked) setThreadModel(id ?? undefined);
    else {
      setNotchModelId(id);
      setThreadModel(undefined);
    }
    focusInput();
  };

  return (
    <NotchPill
      snapshot={shown}
      view={view}
      geometry={geometry}
      shape={shape}
      lead={lead}
      active={active}
      roster={roster}
      answering={answering}
      onReply={reply}
      onOpenChat={openRunChat}
      onPress={press}
      onEnter={enter}
      onLeave={leave}
      onSettled={() => undefined}
      onDismiss={dismiss}
      onHome={() => setOpen("home")}
      onChat={openChat}
      onNewChat={() => {
        chat.reset();
        cowork.reset();
        setBotId(undefined);
        setThreadModel(undefined);
        openChat();
      }}
      onPickBot={pickBot}
      chatBusy={chat.streaming || cowork.running}
      welcomeState={welcomeState}
      drop={drop}
      onBotDropped={() => void takeCapture(captureAtCursor)}
      onAddBot={() => {
        // The app makes bots (ready-made ones to pick, or your own); bring it up there.
        void openTeamInApp(true)
          .then(() => (mode ? exitNotchMode() : openMainFromNotch()))
          .catch(() => undefined);
      }}
      onCapturePick={() => void takeCapture(capturePick)}
      capturing={capturing}
      chat={
        <NotchChat
          ref={inputRef}
          chat={chat}
          geometry={geometry}
          input={input}
          onInput={setInput}
          bot={picked}
          onClearBot={() => {
            if (chat.turns.length) chat.reset();
            setBotId(undefined);
            setThreadModel(undefined);
          }}
          onClose={() => setOpen(null)}
          cowork={cowork}
          folder={folder}
          onFolder={(path) => {
            // Another folder (or none) is another conversation.
            if (path !== folder) cowork.reset();
            setNotchFolder(path);
            focusInput();
          }}
          modelId={modelId}
          pickedModel={pickedModel}
          onPickModel={pickModel}
          panel={panel}
          onPanel={setPanel}
          onOpenChat={(id) => openChatInApp(id)}
          captured={captured && chat.files.some((f) => f.id === captured.attachment.id) ? captured : undefined}
        />
      }
    />
  );
}
