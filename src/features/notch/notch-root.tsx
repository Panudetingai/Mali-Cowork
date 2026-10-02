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
  dropOut,
  exitNotchMode,
  getNotchMode,
  hideNotch,
  listenForNotchGeometry,
  listenForNotchState,
  onNotchDrag,
  onNotchHover,
  onNotchIntro,
  onNotchMode,
  onNotchMoved,
  onNotchSessions,
  onNotchSummon,
  onOpenApp,
  openMainFromNotch,
  openTeamInApp,
  resizeNotch,
  sendNotchAnswer,
  sendNotchReply,
  setNotchBackdrop,
  setNotchHitArea,
  setNotchScreen,
  takeNotchIntro,
  wantNotchSessions,
  type NotchIntro as Intro,
  type NotchCapture,
  type NotchDropTarget,
} from "./bridge";
import { setNotchFolder, useNotchFolder } from "./folders";
import {
  hitArea,
  pillWindow,
  questionHeight,
  radiusOf,
  shapeSize,
} from "./layout";
import { NotchChat, type ChatPanel } from "./notch-chat";
import { NotchIntro } from "./notch-intro";
import { NotchOutro } from "./notch-outro";
import { NotchPill, type ActiveBot } from "./notch-pill";
import {
  setNotchModelId,
  useNotchGlassBlur,
  useNotchLook,
  useNotchModelId,
  useNotchScreen,
} from "./settings";
import { useTeamRoster } from "./team";
import { useNotchText } from "./text";
import type {
  NotchGeometry,
  NotchOverview,
  NotchPeek,
  NotchSession,
  NotchSnapshot,
  NotchView,
} from "./types";
import { useNotchChat } from "./use-notch-chat";
import { useNotchCowork } from "./use-notch-cowork";

const NO_GEOMETRY: NotchGeometry = {
  hasNotch: false,
  notchWidth: 0,
  barHeight: 0,
};
/** Hover opens the pill after a beat, so passing the mouse over doesn't. */
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 380;
/** A single click waits this long in case it's the start of a double-click. */
const CLICK_DELAY_MS = 220;
/** The welcome: thinking this long, then waiting for work; it closes after the rest. */
const WAKE_MS = 1800;
const WELCOME_MS = 4600;
/** A finished run with something to see stays open this long on its own. */
const DONE_MS = 9000;
/** Long enough for a web view's resize to draw (it's blank meanwhile). */
const RESIZE_SETTLE_MS = 350;
/** "Got it!" after a drop, before the ask box takes over. */
const CATCH_MS = 700;
/** Opening the app: the pill folds to its wings before the drop forms under them. */
const FOLD_MS = 260;
/** A peek stays open this long (a diff a little longer), then folds back. */
const PEEK_MS = 3600;
const PEEK_EDIT_MS = 4800;
/** An answer to the agent's question that hasn't landed by now can be sent again. */
const ANSWER_WAIT_MS = 8000;

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

type Open = "home" | "chat" | "welcome" | "done" | "sessions" | "recap" | null;

/** What the last snapshot said, to tell what's news in the next one. */
type Seen = {
  chatId?: string;
  phase?: NotchSnapshot["phase"];
  team: Map<string, boolean>;
  edits: Set<string>;
};

export function NotchRoot() {
  const [snapshot, setSnapshot] = useState<NotchSnapshot | null>(null);
  const [geometry, setGeometry] = useState<NotchGeometry>(NO_GEOMETRY);
  const [mode, setMode] = useState(false);
  const [booted, setBooted] = useState(false);
  const [intro, setIntro] = useState<Intro | null>(null);
  /** Opening the app: the drop falling into it, and the chat to open there. */
  const [outro, setOutro] = useState<{
    id: number;
    target: NotchDropTarget;
    chatId?: string;
  }>();
  const leaving = useRef(false);
  /** The drop that last opened the app: each one opens it once, never again later. */
  const landed = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const screen = useNotchScreen();
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
  const [answered, setAnswered] = useState<{
    id: string;
    reply: "once" | "reject";
  }>();
  const { bot: lead } = useCoworkBot();
  const roster = useTeamRoster();
  const chat = useNotchChat();
  const cowork = useNotchCowork(snapshot);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hovered = useRef(false);
  const t = useNotchText();
  const look = useNotchLook();
  const glassBlur = useNotchGlassBlur();
  /** The system blurs behind the pill (macOS); learned from the first try. */
  const [blur, setBlur] = useState(false);
  const [peek, setPeek] = useState<NotchPeek>();
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [overview, setOverview] = useState<NotchOverview>();
  const sessions = overview?.sessions;
  /** The weekly recap's week: weeks back from this one. */
  const [recapWeek, setRecapWeek] = useState(0);
  /** A chat picked from the list: the ask box carries it on. */
  const [session, setSession] = useState<NotchSession>();
  /** Home shows the whole team; undefined follows whether any of it is working. */
  const [teamOpen, setTeamOpen] = useState<boolean>();

  useEffect(() => listenForNotchState(setSnapshot), []);
  useEffect(() => onNotchSessions(setOverview), []);
  useEffect(() => listenForNotchGeometry(setGeometry), []);
  // Which screen the pill lives on (Settings → Notch): Rust learns it from here.
  useEffect(() => {
    if (isTauri()) void setNotchScreen(screen).catch(() => undefined);
  }, [screen]);
  // Moved to another screen: arrive there rather than just appear.
  useEffect(
    () =>
      onNotchMoved(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
          return;
        stage.current?.animate(
          [
            {
              opacity: 0,
              transform: "translateY(-12px) scale(0.9)",
              filter: "blur(4px)",
            },
            { opacity: 1, transform: "none", filter: "none" },
          ],
          { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.1)" },
        );
      }),
    [],
  );

  // Whether we're in notch mode, and a fly-in to play, before the first resize.
  useEffect(() => {
    if (!isTauri()) return setBooted(true);
    void Promise.all([getNotchMode(), takeNotchIntro()])
      .then(([on, intro]) => {
        setMode(on);
        if (intro) setIntro(intro);
      })
      .catch(() => undefined)
      .finally(() => setBooted(true));
    // Back in notch mode: a drop left over from opening the app is done with.
    // (It stalls while the window is hidden; finishing later, it would open
    // the app again — the pill bounced straight back to the app.)
    const forgetDrop = () => {
      setOutro(undefined);
      leaving.current = false;
    };
    const stopMode = onNotchMode((on) => {
      setMode(on);
      if (!on) setOpen(null);
      else forgetDrop();
    });
    const stopIntro = onNotchIntro(() => {
      forgetDrop();
      void takeNotchIntro().then((intro) => {
        if (intro) setIntro(intro);
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
  const question = permission ? undefined : shown?.question;
  // The notch's own conversation asked: the card sits in its thread, under what the agent said.
  const questionHere =
    !!question &&
    !!shown?.chatId &&
    cowork.turns.some((turn) => turn.chatId === shown.chatId);
  // "Done" shows what a finished run made; once another run starts, it's Home again.
  const made = phase === "done" && !!shown?.showcase?.length;
  const opened = open === "done" && !made ? "home" : open;
  const view: NotchView = permission
    ? "permission"
    : drop
      ? "drop"
      : question
        ? questionHere
          ? "chat"
          : "question"
        : (opened ?? (peek ? "peek" : "collapsed"));
  // Asked in the notch's own thread: the ask box opens on it and stays once it's answered.
  useEffect(() => {
    if (question && questionHere) setOpen("chat");
  }, [question?.id, questionHere]);
  /** The question just answered, until the main window takes it away. */
  const [answeredQuestion, setAnsweredQuestion] = useState<string>();
  const answerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(answerTimer.current), []);
  const questionBusy = !!question && answeredQuestion === question.id;
  const answerQuestion = (answers: string[][]) => {
    if (!shown || !question || questionBusy) return;
    setAnsweredQuestion(question.id);
    // If the answer never lands, the card takes answers again.
    clearTimeout(answerTimer.current);
    answerTimer.current = setTimeout(
      () => setAnsweredQuestion(undefined),
      ANSWER_WAIT_MS,
    );
    void sendNotchAnswer({
      chatId: shown.chatId,
      id: question.id,
      answers,
    }).catch(() => setAnsweredQuestion(undefined));
  };

  // A run that finished with something to see opens the pill on it, the
  // bot pleased with itself; it folds away again unless you're looking.
  const announced = useRef<string>(undefined);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(doneTimer.current), []);
  useEffect(() => {
    if (!snapshot || snapshot.phase !== "done" || !snapshot.showcase?.length)
      return;
    const key = `${snapshot.chatId}:${snapshot.showcase.map((s) => s.items.length).join(",")}`;
    if (announced.current === key) return;
    announced.current = key;
    // Asking in the notch, or looking at something else there: the thread shows it.
    if (open === "chat" || open === "welcome" || leaving.current) return;
    setOpen("done");
    clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => {
      if (!hovered.current) setOpen((o) => (o === "done" ? null : o));
    }, DONE_MS);
  }, [snapshot, open]);

  // ── who's in the main spot ──
  const leadName = BOTS.find((b) => b.id === lead)?.name ?? "Mali";
  const picked = roster.find((b) => b.id === botId);
  const stepping = snapshot?.team.filter((m) => !m.done).at(-1);
  const active: ActiveBot = shown?.asker
    ? { key: shown.asker.id, bot: shown.asker.mascot, name: shown.asker.name }
    : view === "peek" && peek?.bot
      ? { key: peek.bot.key, bot: peek.bot.mascot, name: peek.bot.name }
      : view === "chat" && picked
        ? { key: picked.id, bot: picked.mascot, name: picked.name }
        : stepping && phase === "working"
          ? { key: stepping.id, bot: stepping.mascot, name: stepping.name }
          : { key: "lead", bot: lead, name: leadName };

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 140);

  // ── peeks ──
  // News in a snapshot opens the collapsed pill out for a moment: the run
  // finished or failed, a team bot took over or finished, a file was written.
  const quiet = useRef(true);
  quiet.current =
    open !== null ||
    !!permission ||
    !!question ||
    !!drop ||
    !!intro ||
    !!outro ||
    leaving.current;
  const showPeek = (next: NotchPeek) => {
    if (quiet.current) return;
    clearTimeout(peekTimer.current);
    setPeek(next);
    peekTimer.current = setTimeout(
      () => {
        if (!hovered.current) setPeek(undefined);
      },
      next.tone === "edit" ? PEEK_EDIT_MS : PEEK_MS,
    );
  };
  const showPeekRef = useRef(showPeek);
  showPeekRef.current = showPeek;
  const seen = useRef<Seen>({ team: new Map(), edits: new Set() });
  const words = useRef({ t, leadName, lead, active });
  words.current = { t, leadName, lead, active };
  useEffect(() => {
    const was = seen.current;
    seen.current = {
      chatId: snapshot?.chatId,
      phase: snapshot?.phase,
      team: new Map(snapshot?.team.map((m) => [m.id, m.done])),
      edits: new Set(snapshot?.edits?.map((e) => e.id)),
    };
    // Only news within one run: a run first seen (or another one) is the news itself.
    if (!snapshot || !was.chatId || was.chatId !== snapshot.chatId) return;
    const { t, leadName, lead, active } = words.current;
    const me = { key: "lead", mascot: lead, name: leadName };
    const ended = was.phase !== "done" && snapshot.phase === "done";
    if (ended && snapshot.failed) {
      return showPeekRef.current({
        id: `failed:${snapshot.chatId}`,
        tone: "failed",
        title: t("peekFailed", { name: leadName }),
        detail: snapshot.failed,
        bot: me,
      });
    }
    // A run that made something opens on it instead ("done").
    if (ended && !snapshot.showcase?.length) {
      return showPeekRef.current({
        id: `done:${snapshot.chatId}`,
        tone: "done",
        title: t("peekFinished", { name: leadName }),
        detail: snapshot.changed
          ? t("peekChanged", { n: snapshot.changed })
          : snapshot.title,
        bot: me,
      });
    }
    if (snapshot.phase === "done") return;
    for (const mate of snapshot.team) {
      const before = was.team.get(mate.id);
      const bot = { key: mate.id, mascot: mate.mascot, name: mate.name };
      if (!mate.done && before !== false) {
        return showPeekRef.current({
          id: `team:${mate.id}:${Date.now()}`,
          tone: "team",
          title: t("peekTakesOver", { name: mate.name }),
          detail: mate.status,
          bot,
        });
      }
      if (mate.done && before === false) {
        return showPeekRef.current({
          id: `team-done:${mate.id}:${Date.now()}`,
          tone: "done",
          title: t("peekFinished", { name: mate.name }),
          detail: snapshot.title,
          bot,
        });
      }
    }
    const edit = snapshot.edits?.filter((e) => !was.edits.has(e.id)).at(-1);
    if (edit) {
      showPeekRef.current({
        id: `edit:${edit.id}`,
        tone: "edit",
        title: t(edit.kind === "added" ? "peekCreated" : "peekEdited", {
          name: active.name,
        }),
        edit,
        bot: { key: active.key, mascot: active.bot, name: active.name },
      });
    }
  }, [snapshot]);
  // Opening the pill (or an approval) puts a peek away.
  useEffect(() => {
    if (open !== null || permission || question) setPeek(undefined);
  }, [open, permission, question]);
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  // ── window size ──
  // The model and folder lists leave with the ask box.
  useEffect(() => {
    if (view !== "chat") setPanel(null);
  }, [view]);

  const thread = session
    ? true
    : folder
      ? cowork.turns.length > 0
      : chat.turns.length > 0;
  const working = (snapshot?.team ?? []).some((m) => !m.done);
  const teamShown = teamOpen ?? working;
  const shape = shapeSize(view, geometry, {
    thread: thread || !!panel,
    files: chat.files.length > 0 || chat.importing > 0,
    note: !!chat.note && panel !== "folders",
    peek: peek?.tone,
    sessions: sessions?.length ?? 1,
    models: overview?.recap.models.length,
    team: roster.length,
    teamOpen: teamShown,
    question:
      view === "question" || (view === "chat" && questionHere)
        ? questionHeight(question)
        : undefined,
  });
  // One window size for every view (it changes only with the screen); the
  // pill animates inside it, and only its own area takes clicks.
  const frame = pillWindow(geometry);
  const focusable =
    view === "permission" || view === "question" || view === "chat";
  // The fly-in and the drop into the app have the window meanwhile.
  const sizing = booted && !intro && !outro && !!shown;
  useEffect(() => {
    if (!sizing) return;
    void resizeNotch(frame.width, frame.height, focusable).catch(
      () => undefined,
    );
  }, [sizing, frame.width, frame.height, focusable]);
  const area = hitArea(frame, shape);
  useEffect(() => {
    if (!sizing) return;
    void setNotchHitArea(area, view !== "collapsed").catch(() => undefined);
  }, [sizing, area.x, area.y, area.width, area.height, view]);

  // The frosted backdrop follows the open pill; the collapsed one is the notch's black.
  // It grows out of the collapsed pill and folds back into it, along with the shape.
  const frosted = sizing && look === "glass" && view !== "collapsed";
  const radius = radiusOf(view, geometry);
  const backdropX = (frame.width - shape.width) / 2;
  const folded = shapeSize("collapsed", geometry);
  const foldedRadius = radiusOf("collapsed", geometry);
  const wasFrosted = useRef(false);
  const clearedBlur = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    // Glass is gone. The first pass takes away any blur left on the window.
    if (!frosted && !wasFrosted.current && clearedBlur.current) return;
    clearedBlur.current = true;
    wasFrosted.current = frosted;
    const rect = {
      x: backdropX,
      y: 0,
      width: shape.width,
      height: shape.height,
      radius,
    };
    const notch = {
      x: (frame.width - folded.width) / 2,
      y: 0,
      width: folded.width,
      height: folded.height,
      radius: foldedRadius,
    };
    // Still sized for the pill: fold into it; mid fly-in or drop-out, just go.
    const away = sizing ? notch : undefined;
    void (
      frosted
        ? setNotchBackdrop(look, rect, notch)
        : setNotchBackdrop("black", away)
    )
      .then((ok) => setBlur(ok))
      .catch(() => setBlur(false));
  }, [
    frosted,
    look,
    glassBlur,
    backdropX,
    shape.width,
    shape.height,
    radius,
    sizing,
    frame.width,
    folded.width,
    folded.height,
    foldedRadius,
  ]);

  // The overview (sessions, usage, the week's recap) is worked out by the
  // main window only while Home or the list is on screen.
  const listing = view === "sessions" || view === "home" || view === "recap";
  // Home's page shows this week; only the recap goes back.
  const week = view === "recap" ? recapWeek : 0;
  useEffect(() => {
    if (!isTauri()) return;
    void wantNotchSessions(listing, week).catch(() => undefined);
  }, [listing, week]);
  useEffect(() => {
    if (view !== "recap") setRecapWeek(0);
  }, [view]);
  // Home forgets a team opened or closed by hand once it closes.
  useEffect(() => {
    if (view !== "home") setTeamOpen(undefined);
  }, [view]);

  // ── opening and closing ──
  const sticky = () =>
    open === "chat" &&
    (!!panel ||
      (!!question && questionHere) ||
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
    // A peek being read stays until the pointer leaves it.
    if (view === "peek") return clearTimeout(peekTimer.current);
    if (view === "collapsed")
      hoverTimer.current = setTimeout(() => setOpen("home"), OPEN_DELAY_MS);
  };
  const leave = () => {
    hovered.current = false;
    clearTimeout(hoverTimer.current);
    if (view === "peek") {
      clearTimeout(peekTimer.current);
      peekTimer.current = setTimeout(() => setPeek(undefined), CLOSE_DELAY_MS);
      return;
    }
    if (open && !sticky())
      hoverTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  };
  const enterRef = useRef(enter);
  enterRef.current = enter;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  // The page can't see the mouse while Mali is in the background; Rust can.
  useEffect(
    () =>
      onNotchHover((inside) =>
        inside ? enterRef.current() : leaveRef.current(),
      ),
    [],
  );

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
        if (viewRef.current === "chat" && document.hasFocus())
          return setOpen(null);
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
        if (payload.type === "enter")
          fileDrag.current = payload.paths.length > 0;
        if (
          (payload.type === "enter" || payload.type === "over") &&
          !fileDrag.current
        )
          return;
        if (payload.type === "enter" || payload.type === "over")
          setDrop((d) => d ?? "over");
        // Leaving the pill while still dragging near the top keeps the zone open.
        else if (payload.type === "leave")
          setDrop((d) => (d === "over" && dragNear.current ? d : undefined));
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
  const answering =
    permission && answered?.id === permission.id ? answered.reply : undefined;
  const reply = (choice: "once" | "reject") => {
    if (!shown || !permission || answering) return;
    setAnswered({ id: permission.id, reply: choice });
    void sendNotchReply({
      chatId: shown.chatId,
      id: permission.id,
      reply: choice,
    }).catch(() => setAnswered(undefined));
  };
  const replyRef = useRef(reply);
  replyRef.current = reply;

  // Y allows, N or Esc denies — only while an approval is on the pill.
  // Physical key codes (not `event.key`) so Thai / other IMEs still work.
  useEffect(() => {
    if (!permission) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.code === "KeyY") replyRef.current("once");
      else if (event.code === "KeyN" || event.key === "Escape")
        replyRef.current("reject");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [permission]);

  // ── opening the app ──
  // The pill folds to its wings, a drop forms under them and falls into the
  // middle of the main window, which opens out of it as it lands.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const openApp = (chatId?: string) => {
    if (leaving.current) return;
    leaving.current = true;
    const direct = () => {
      leaving.current = false;
      void (
        modeRef.current ? exitNotchMode(chatId) : openMainFromNotch(chatId)
      ).catch(() => undefined);
    };
    const folding = open !== null || !!panel;
    setOpen(null);
    setTimeout(
      () =>
        void dropOut()
          .catch(() => null)
          .then((target) =>
            target ? setOutro({ id: Date.now(), target, chatId }) : direct(),
          ),
      folding ? FOLD_MS : 0,
    );
  };
  const openAppRef = useRef(openApp);
  openAppRef.current = openApp;
  // The Dock or the tray asked for the app: drop into it.
  useEffect(() => onOpenApp(() => openAppRef.current()), []);

  const color = BOTS.find((b) => b.id === lead)?.color ?? "#3aa3f5";
  const outroView = outro && (
    <NotchOutro
      key={outro.id}
      target={outro.target}
      color={color}
      top={shape.height}
      onLanded={() => {
        if (landed.current >= outro.id) return;
        landed.current = outro.id;
        void (
          modeRef.current
            ? exitNotchMode(outro.chatId)
            : openMainFromNotch(outro.chatId)
        ).catch(() => undefined);
      }}
      onDone={() => {
        setOutro(undefined);
        leaving.current = false;
      }}
    />
  );
  if (intro) {
    return (
      <NotchIntro
        from={intro.from}
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
              if (!hovered.current)
                setOpen((o) => (o === "welcome" ? null : o));
            }, WELCOME_MS);
          }, RESIZE_SETTLE_MS);
        }}
      />
    );
  }
  if (!shown) {
    // Notch mode just ended: the splash plays out over the opening app.
    // Same tree as below, so the drop isn't mounted afresh (and played again).
    return outroView ? (
      <div ref={stage} className="relative size-full origin-top">
        {null}
        {outroView}
      </div>
    ) : null;
  }

  const openChatInApp = (id?: string) => openApp(id);
  const openRunChat = () =>
    openChatInApp(
      view === "chat"
        ? session
          ? session.id
          : folder
            ? cowork.chatId
            : chat.savedChatId()
        : shown.chatId || undefined,
    );
  const press = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      setPeek(undefined);
      // A finished run (outside notch mode) opens its chat; otherwise the pill opens.
      if (made) setOpen("done");
      else if (phase === "done" && !mode) openRunChat();
      else setOpen("home");
    }, CLICK_DELAY_MS);
  };
  const dismiss = () => {
    clearTimeout(pressTimer.current);
    clearTimeout(hoverTimer.current);
    setOpen(null);
    void hideNotch().catch(() => undefined);
  };
  /** Ask a team bot directly ("lead": Mali): a fresh question to it, with it in the main spot. */
  const pickBot = (pick: string) => {
    const id = pick === "lead" ? undefined : pick;
    if (id !== botId && chat.turns.length) chat.reset();
    if (id !== botId) setThreadModel(undefined);
    setBotId(id);
    setSession(undefined);
    openChat();
  };
  /** A chat from the list: carry it on in the ask box, on its own model unless one is picked. */
  const pickSession = (picked: NotchSession) => {
    setSession(picked);
    setBotId(undefined);
    setThreadModel(undefined);
    setPanel(null);
    openChat();
  };
  // A team bot answers on its own model unless one is picked for it here;
  // Mali answers on the notch's pick, else the Quick bar's.
  const modelId =
    threadModel ?? (picked ? undefined : (notchModel ?? undefined));
  const pickedModel =
    threadModel ?? (picked ? picked.modelId || null : notchModel);
  const pickModel = (id: string | null) => {
    if (picked) setThreadModel(id ?? undefined);
    else {
      setNotchModelId(id);
      setThreadModel(undefined);
    }
    focusInput();
  };

  return (
    <div ref={stage} className="relative size-full origin-top">
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
        onAnswer={answerQuestion}
        questionBusy={questionBusy}
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
          setSession(undefined);
          openChat();
        }}
        onPickBot={pickBot}
        peek={peek}
        onPeekClose={() => {
          clearTimeout(peekTimer.current);
          setPeek(undefined);
        }}
        sessions={sessions}
        usage={overview?.usage}
        recap={overview?.recap}
        onRecap={() => setOpen("recap")}
        onRecapWeek={setRecapWeek}
        onSessions={() => setOpen("sessions")}
        onPickSession={pickSession}
        teamOpen={teamShown}
        onTeamOpen={setTeamOpen}
        look={look}
        glassBlur={glassBlur}
        blur={blur}
        chatBusy={chat.streaming || cowork.running}
        welcomeState={welcomeState}
        drop={drop}
        onBotDropped={() => void takeCapture(captureAtCursor)}
        onAddBot={() => {
          // The app makes bots (ready-made ones to pick, or your own); bring it up there.
          void openTeamInApp(true)
            .then(() => openApp())
            .catch(() => undefined);
        }}
        onCapturePick={() => void takeCapture(capturePick)}
        capturing={capturing}
        chat={
          view === "chat" ? (
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
                chat.setNote(undefined);
                focusInput();
              }}
              modelId={modelId}
              pickedModel={pickedModel}
              onPickModel={pickModel}
              panel={panel}
              onPanel={setPanel}
              onOpenChat={(id) => openChatInApp(id)}
              captured={
                captured &&
                chat.files.some((f) => f.id === captured.attachment.id)
                  ? captured
                  : undefined
              }
              session={session}
              question={questionHere ? question : undefined}
              questionAsker={shown.asker?.name ?? active.name}
              questionBusy={questionBusy}
              onAnswer={answerQuestion}
              onLeaveSession={() => {
                setSession(undefined);
                focusInput();
              }}
            />
          ) : null
        }
      />
      {outroView}
    </div>
  );
}
