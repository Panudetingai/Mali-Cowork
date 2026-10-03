/**
 * The pill: a black shape that grows out of the notch. It's always dark (it
 * has to read as part of the notch), so it uses fixed colors rather than the
 * app's theme.
 *
 * Only the bot in the main spot is a live animation (an iframe each); the
 * team's chips and the session list draw small static faces, so the pill
 * stays cheap while it sits on screen all day. When a team bot takes over,
 * the main bot vanishes in a puff and pops up in its chip, and the team bot
 * puffs out of its chip into the main spot. The shape springs between sizes
 * and the content inside fades through a blur.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import { resolveBotNow, useResolvedBot } from "@/features/bot-studio/resolve";
import { useBotPicture } from "@/components/anim/cowork-bot-picture";
import { type BotState, type BotChoice } from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/pages/chat/api/chat";
import {
  ArrowUpRightIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CircleIcon,
  FileTextIcon,
  GlobeIcon,
  HammerIcon,
  HistoryIcon,
  HomeIcon,
  LayersIcon,
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useAnimate,
  type Transition,
} from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { onNotchWheel } from "./bridge";
import {
  EAR,
  PAD,
  QUESTION_LEFT,
  RECAP,
  SESSION_HEADER,
  SESSION_ROW,
  TEAM_HEADER,
  TEAM_SHOWN,
  WING,
  barOf,
  homeCards,
  mascotFrame,
  radiusOf,
  sideOf,
  teamSlots,
  topRowOf,
  type Box,
  type Size,
} from "./layout";
import { NotchQuestion } from "./notch-question";
import { Showcase, ShowcaseViewerHost } from "./notch-showcase";
import { minutesSaved } from "./recap";
import {
  glassBlurVisuals,
  setNotchLook,
  setNotchRates,
  setNotchSaveChats,
  setNotchScreenPref,
  useNotchLook,
  useNotchRates,
  useNotchSaveChats,
  useNotchScreen,
} from "./settings";
import type { RosterBot } from "./team";
import { useNotchText, type NotchText } from "./text";
import type {
  NotchEdit,
  NotchGeometry,
  NotchLook,
  NotchMate,
  NotchPeek,
  NotchRecap,
  NotchSession,
  NotchSnapshot,
  NotchStep,
  NotchUsage,
  NotchView,
} from "./types";

/** Dynamic Island–like: quick open/close, minimal bounce. */
const SPRING: Transition = {
  type: "spring",
  stiffness: 340,
  damping: 36,
  mass: 1,
};
const AMBER = "#f5a524";
const GREEN = "#34c77b";
const RED = "#f0443a";
const BLUE = "#3aa3f5";

/** Who is in the main spot: Mali ("lead") or a team bot by its id. */
export type ActiveBot = { key: string; bot: BotChoice; name: string };

type Props = {
  snapshot: NotchSnapshot;
  view: NotchView;
  geometry: NotchGeometry;
  shape: Size;
  /** The user's own bot: Mali, the lead. */
  lead: BotChoice;
  active: ActiveBot;
  /** The bots on the user's team. */
  roster: RosterBot[];
  /** An answer was sent and the main window hasn't confirmed it yet. */
  answering: "once" | "reject" | undefined;
  onReply: (reply: "once" | "reject") => void;
  /** The agent's question, answered (`view` "question"); the answer is on its way. */
  onAnswer?: (answers: string[][]) => void;
  questionBusy?: boolean;
  onOpenChat: () => void;
  onPress: () => void;
  onEnter: () => void;
  onLeave: () => void;
  /** The shape reached its size: the window can shrink to it. */
  onSettled: () => void;
  /** Double-click the bot: put the pill away for now. */
  onDismiss: () => void;
  onHome: () => void;
  onChat: () => void;
  onNewChat: () => void;
  /** Ask a team bot directly. */
  onPickBot: (id: string) => void;
  /** The ask box, when `view` is "chat". */
  chat?: ReactNode;
  /** An answer is being written in the ask box. */
  chatBusy?: boolean;
  /** The welcome's pose: thinking, then waiting for work. */
  welcomeState?: BotState;
  /** Files over the pill, or just dropped on it. */
  drop?: "over" | "taken";
  /** The bot was dragged out and let go somewhere: capture what's there. */
  onBotDropped: () => void;
  /** The camera button: pick a window to capture. */
  onCapturePick: () => void;
  /** Make a bot: the app's Settings → Team, with the new-bot form open. */
  onAddBot: () => void;
  /** A capture is being taken. */
  capturing?: boolean;
  /** The news the pill opened out to tell (`view` "peek"). */
  peek?: NotchPeek;
  onPeekClose?: () => void;
  /** Chats to pick up again (`view` "sessions"); undefined until the main window sends them. */
  sessions?: NotchSession[];
  onSessions?: () => void;
  onPickSession?: (session: NotchSession) => void;
  /** Home shows every bot on the team, not just the group's row. */
  teamOpen?: boolean;
  onTeamOpen?: (open: boolean) => void;
  /** How the open pill looks, and whether the system blurs what's behind it. */
  look?: NotchLook;
  /** Glass only: frosted blur strength (0–100). */
  glassBlur?: number;
  blur?: boolean;
  /** Home's left card, past the run: how much Cowork did today, and the week's recap. */
  usage?: NotchUsage;
  recap?: NotchRecap;
  /** Open the weekly recap; pick another week in it (weeks back from this one). */
  onRecap?: () => void;
  onRecapWeek?: (week: number) => void;
  /** The page Home's left card is on (the pill keeps it). */
  slide?: number;
  onSlide?: (slide: number) => void;
};

export function NotchPill(outer: Props) {
  // Home's left card keeps its page while Home is open; it starts over next time.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (outer.view !== "home") setSlide(0);
  }, [outer.view]);
  const props: Props = { ...outer, slide, onSlide: setSlide };
  const { view, geometry, shape, snapshot } = props;
  const radius = radiusOf(view, geometry);
  const open = view !== "collapsed";
  const look = props.look ?? "black";
  // The collapsed pill is part of the notch: black, whatever the look.
  const tinted = open && look !== "black";
  const lightShell = tinted && look === "light";
  return (
    <MotionConfig transition={SPRING} reducedMotion="user">
      <div className="flex size-full justify-center overflow-hidden select-none">
        <motion.div
          className="relative shrink-0"
          initial={false}
          animate={{ width: shape.width, height: shape.height }}
          onAnimationComplete={props.onSettled}
          onMouseEnter={props.onEnter}
          onMouseLeave={props.onLeave}
        >
          <Ear side="left" color={shellColor(look, tinted)} />
          <Ear side="right" color={shellColor(look, tinted)} />
          <motion.div
            className={cn(
              "absolute inset-0 overflow-hidden",
              !lightShell && "text-white",
            )}
            style={lightShell ? LIGHT_VARS : undefined}
            initial={false}
            animate={{
              borderBottomLeftRadius: radius,
              borderBottomRightRadius: radius,
              boxShadow: open
                ? lightShell
                  ? "0 18px 40px -14px rgba(0,0,0,0.12)"
                  : "0 18px 40px -14px rgba(0,0,0,0.7)"
                : "0 0 0 0 rgba(0,0,0,0)",
            }}
            onClick={
              view === "collapsed" || view === "peek"
                ? props.onPress
                : undefined
            }
          >
            <LookLayers
              look={look}
              tinted={tinted}
              blur={!!props.blur}
              glassBlur={props.glassBlur ?? 55}
              top={topRowOf(geometry)}
            />
            <ShowcaseViewerHost resetKey={view}>
              <div className="absolute inset-0">
                <AnimatePresence initial={false}>
                  {view === "permission" && <PermissionGlow key="glow" />}
                  {view === "question" && (
                    <PermissionGlow key="question-glow" color={BLUE} />
                  )}
                  {view === "drop" && (
                    <DropGlow key="drop-glow" geometry={geometry} />
                  )}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                  {view === "collapsed" && (
                    <Fade key="collapsed">
                      <Collapsed {...props} />
                    </Fade>
                  )}
                  {view === "home" && (
                    <Fade key="home">
                      <Home {...props} />
                    </Fade>
                  )}
                  {view === "welcome" && (
                    <Fade key="welcome">
                      <Welcome {...props} />
                    </Fade>
                  )}
                  {view === "drop" && (
                    <Fade key="drop">
                      <Drop {...props} />
                    </Fade>
                  )}
                  {view === "chat" && <Fade key="chat">{props.chat}</Fade>}
                  {view === "done" && (
                    <Fade key="done">
                      <Done {...props} />
                    </Fade>
                  )}
                  {view === "sessions" && (
                    <Fade key="sessions">
                      <Sessions {...props} />
                    </Fade>
                  )}
                  {view === "recap" && (
                    <Fade key="recap">
                      <Recap {...props} />
                    </Fade>
                  )}
                  {view === "peek" && props.peek && (
                    <Fade key={`peek:${props.peek.id}`}>
                      <Peek {...props} peek={props.peek} />
                    </Fade>
                  )}
                  {view === "permission" && snapshot.permission && (
                    <Fade key="permission">
                      <Permission {...props} />
                    </Fade>
                  )}
                  {view === "question" && snapshot.question && (
                    <Fade key={`question:${snapshot.question.id}`}>
                      <QuestionView {...props} />
                    </Fade>
                  )}
                </AnimatePresence>
              </div>
              {/* Above the content, so the bots sit on their cards and chips. */}
              <Mascots {...props} />
              {(view === "home" ||
                view === "chat" ||
                view === "welcome" ||
                view === "drop" ||
                view === "done" ||
                view === "sessions" ||
                view === "recap") && <TopBar {...props} />}
            </ShowcaseViewerHost>
          </motion.div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

/**
 * Tailwind's white and black, swapped: every `text-white/…` and `bg-white/…`
 * in the body reads dark on the light look, with no second set of classes.
 */
const LIGHT_VARS = {
  "--color-white": "#16161b",
  "--color-black": "#ffffff",
  color: "#16161b",
  /* Notch stays on forced dark theme; remap ink so `.chat-markdown` reads on white. */
  "--foreground": "oklch(0.153 0.006 107.1)",
  "--muted-foreground": "oklch(0.45 0.02 107.1)",
  "--border": "oklch(0 0 0 / 12%)",
  "--primary": "oklch(0.554 0.135 66.442)",
} as CSSProperties;
/** Back to the notch's own whites, for what stays dark in every look (a peek's card, a diff). */
const DARK_VARS = {
  "--color-white": "#ffffff",
  "--color-black": "#000000",
  color: "#ffffff",
} as CSSProperties;

/** What each look lays under the open pill's body; with the system's blur behind, it can let some through. */
const TINT: Record<
  Exclude<NotchLook, "black">,
  { blur: string; solid: string }
> = {
  glass: { blur: "rgba(12,12,16,0.28)", solid: "rgba(24,24,30,0.88)" },
  light: { blur: "#ffffff", solid: "#ffffff" },
};

function shellColor(look: NotchLook, tinted: boolean) {
  if (!tinted || look === "black") return "#000";
  return look === "light" ? TINT.light.solid : "#141418";
}

/**
 * The pill's ground: black when collapsed, and a translucent tint when open
 * (glass keeps a soft dark edge at the top; light is white all the way up).
 */
function LookLayers({
  look,
  tinted,
  blur,
  glassBlur,
  top,
}: {
  look: NotchLook;
  tinted: boolean;
  blur: boolean;
  glassBlur: number;
  top: number;
}) {
  const tint = look === "black" ? undefined : TINT[look];
  // Light is an opaque invert of black: same content, opposite colors, no frost.
  const frosted = tinted && look === "glass";
  const glass = look === "glass" ? glassBlurVisuals(glassBlur) : undefined;
  const shellBg =
    look === "light"
      ? "#ffffff"
      : look === "glass" && glass
        ? frosted
          ? `rgba(12,12,16,${glass.tintAlpha})`
          : TINT.glass.solid
        : tint
          ? frosted
            ? tint.blur
            : tint.solid
          : undefined;
  // System backdrop (macOS NSVisualEffect / Windows Mica): skip CSS backdrop-filter — stacking it causes a circular smudge in WebView2.
  const shellFilter =
    tinted && look === "glass" && glass && !blur
      ? {
          backdropFilter: `blur(${glass.blurPx}px) saturate(150%)`,
          WebkitBackdropFilter: `blur(${glass.blurPx}px) saturate(150%)`,
        }
      : undefined;
  return (
    <>
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-black"
        initial={false}
        animate={{ opacity: tinted ? 0 : 1 }}
        transition={{ duration: 0.22 }}
      />
      {tint && (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{ background: shellBg, ...shellFilter }}
          initial={false}
          animate={{ opacity: tinted ? 1 : 0 }}
          transition={{ duration: 0.22 }}
        />
      )}
      {tint && look === "glass" && glass && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: top + (blur ? 12 : 20),
            background: blur
              ? `linear-gradient(rgba(8,8,12,${glass.hoodAlpha}) 0px, rgba(8,8,12,${glass.hoodAlpha * 0.25}) ${top}px, transparent 100%)`
              : `linear-gradient(rgba(8,8,12,0.85) 0px, transparent ${top + 16}px)`,
          }}
          initial={false}
          animate={{ opacity: tinted ? 1 : 0 }}
          transition={{ duration: 0.22 }}
        />
      )}
    </>
  );
}

/** The concave curve joining the pill to the top edge, like the notch's own. */
function Ear({ side, color }: { side: "left" | "right"; color: string }) {
  const at = side === "left" ? "0% 100%" : "100% 100%";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0"
      style={{
        width: EAR,
        height: EAR,
        [side]: -EAR,
        background: `radial-gradient(circle at ${at}, transparent ${EAR - 0.5}px, ${color} ${EAR}px)`,
      }}
    />
  );
}

/** Content swaps blur through each other, a beat after the shape starts moving. */
function Fade({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0"
      initial={{ opacity: 0, filter: "blur(8px)", scale: 0.97 }}
      animate={{
        opacity: 1,
        filter: "blur(0px)",
        scale: 1,
        transition: { delay: 0.08, duration: 0.28 },
      }}
      exit={{
        opacity: 0,
        filter: "blur(6px)",
        scale: 0.98,
        transition: { duration: 0.14 },
      }}
    >
      {children}
    </motion.div>
  );
}

// ── top bar ──

/** Home, Chat and a new question on the left; keeping chats and the app on the right. */
function TopBar({
  view,
  geometry,
  shape,
  snapshot,
  look,
  onHome,
  onChat,
  onNewChat,
  onOpenChat,
  onCapturePick,
  onSessions,
  capturing,
}: Props) {
  const top = topRowOf(geometry);
  const side = sideOf(geometry, shape);
  const save = useNotchSaveChats();
  const t = useNotchText();
  const light = look === "light";
  return (
    <div
      className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3.5"
      style={{ height: top }}
    >
      <div className="flex items-center gap-1" style={{ maxWidth: side }}>
        <Tab
          title={t("home")}
          on={view === "home" || view === "welcome"}
          onClick={onHome}
        >
          <HomeIcon className="size-3.5" />
        </Tab>
        <Tab title={t("ask")} on={view === "chat"} onClick={onChat}>
          <MessageCircleIcon className="size-3.5" />
        </Tab>
        {onSessions && (
          <Tab
            title={t("sessions")}
            on={view === "sessions"}
            onClick={onSessions}
          >
            <LayersIcon className="size-3.5" />
          </Tab>
        )}
        <Tab title={t("newQuestion")} onClick={onNewChat}>
          <PlusIcon className="size-3.5" />
        </Tab>
        <Tab title={t("capture")} onClick={onCapturePick}>
          {capturing ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <CameraIcon className="size-3.5" />
          )}
        </Tab>
      </div>
      <div
        className="flex items-center justify-end gap-1.5 text-[11px]"
        style={{ maxWidth: side }}
      >
        {view === "home" && snapshot.running > 1 && (
          <span className="text-white/50">
            {t("running", { n: snapshot.running })}
          </span>
        )}
        {view === "chat" && (
          <button
            type="button"
            onClick={() => setNotchSaveChats(!save)}
            title={save ? t("savedHint") : t("notSavedHint")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
              save
                ? "bg-white/[0.08] text-white/70 hover:bg-white/[0.14]"
                : light
                  ? "bg-amber-500/15 text-amber-900 hover:bg-amber-500/25"
                  : "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25",
            )}
          >
            <HistoryIcon className="size-3" />
            {save ? t("saved") : t("notSaved")}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenChat}
          className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-white/70 transition-colors hover:bg-white/[0.16] hover:text-white"
        >
          {t("openMali")}
          <ArrowUpRightIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

function Tab({
  title,
  on,
  onClick,
  children,
}: {
  title: string;
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative flex h-7 w-8 items-center justify-center rounded-full transition-colors",
        on ? "text-white" : "text-white/45 hover:text-white/80",
      )}
    >
      {on && (
        <motion.span
          layoutId="notch-tab"
          className="absolute inset-0 rounded-full bg-white/[0.12]"
        />
      )}
      <span className="relative">{children}</span>
    </button>
  );
}

// ── bots ──

function mainState({
  snapshot,
  view,
  chatBusy,
  welcomeState,
  drop,
  active,
  peek,
}: Props): BotState {
  if (view === "permission") return "permission";
  if (view === "question") return "question";
  if (view === "done") return "done";
  if (view === "welcome") return welcomeState ?? "idle";
  if (view === "drop") return drop === "taken" ? "done" : "welcome";
  if (view === "chat") return chatBusy ? "thinking" : "idle";
  if (view === "sessions") return "idle";
  if (view === "peek" && peek) {
    return peek.tone === "done"
      ? "done"
      : peek.tone === "failed"
        ? "alert"
        : peek.tone === "edit"
          ? "tool"
          : "working";
  }
  if (snapshot.phase === "idle") return chatBusy ? "thinking" : "idle";
  if (snapshot.phase === "done" && active.key === "lead") return "done";
  return view === "collapsed" ? "working" : "tool";
}

function colorOf(bot: BotChoice) {
  return resolveBotNow(bot).color ?? BLUE;
}

/** How long a bot takes to vanish, before the next one pops up in its place. */
const VANISH_S = 0.16;

/**
 * The main spot. Only bots that have stood in it are mounted (each is an
 * iframe), and they stay mounted — one that unmounts reloads, which
 * flickers — resting while another has the spot. A change of bot is a
 * teleport, not a glide: the one leaving shrinks away with a twist, a puff
 * marks the spot, and the new one pops up out of it.
 */
function Mascots(props: Props) {
  const { view, geometry, shape, active } = props;
  const frame = mascotFrame(
    view,
    geometry,
    shape,
    view === "home" ? props.slide : 0,
  );
  const mounted = useRef(new Map<string, BotChoice>());
  mounted.current.set(active.key, active.bot);
  const state = mainState(props);
  const [puffs, setPuffs] = useState<{ id: number; color: string }[]>([]);
  const last = useRef(active.key);
  useEffect(() => {
    if (last.current === active.key) return;
    last.current = active.key;
    const id = Date.now();
    setPuffs((p) => [...p.slice(-2), { id, color: colorOf(active.bot) }]);
    // Not cleared with the next swap: each puff plays out and goes on its own.
    setTimeout(() => setPuffs((p) => p.filter((x) => x.id !== id)), PUFF_MS);
  }, [active.key, active.bot]);
  const center = { x: frame.x + frame.size / 2, y: frame.y + frame.size / 2 };
  return (
    <>
      {[...mounted.current].map(([key, bot]) => {
        const on = key === active.key;
        return (
          <motion.div
            key={key}
            className={cn(
              "absolute top-0 left-0 z-10",
              on ? "cursor-pointer" : "pointer-events-none",
            )}
            initial={{
              opacity: 0,
              scale: 0.2,
              x: frame.x,
              y: frame.y,
              width: frame.size,
              height: frame.size,
            }}
            animate={{
              opacity: on ? 1 : 0,
              scale: on ? 1 : 0.15,
              rotate: on ? 0 : -30,
              x: frame.x,
              y: frame.y,
              width: frame.size,
              height: frame.size,
              transition: on
                ? {
                    ...SPRING,
                    opacity: { duration: 0.12, delay: VANISH_S },
                    scale: {
                      type: "spring",
                      stiffness: 520,
                      damping: 17,
                      delay: VANISH_S,
                    },
                    rotate: {
                      type: "spring",
                      stiffness: 300,
                      damping: 20,
                      delay: VANISH_S,
                    },
                  }
                : {
                    ...SPRING,
                    opacity: { duration: VANISH_S },
                    scale: { duration: VANISH_S },
                    rotate: { duration: VANISH_S },
                  },
            }}
            onDoubleClick={
              on
                ? (event) => {
                    event.stopPropagation();
                    props.onDismiss();
                  }
                : undefined
            }
            title={on ? "Double-click to hide" : undefined}
          >
            {on &&
              view !== "collapsed" &&
              view !== "chat" &&
              view !== "sessions" && <Glow {...props} bot={bot} />}
            <CoworkBot
              size="100%"
              bot={bot}
              state={on ? state : "idle"}
              theme="dark"
              className="relative"
              // Kept mounted (no reload flicker) but resting while away.
              paused={!on}
            />
            {on && <Badges {...props} />}
            {on && view !== "permission" && view !== "question" && (
              <BotHandle {...props} bot={bot} />
            )}
          </motion.div>
        );
      })}
      {puffs.map((puff) => (
        <Puff
          key={puff.id}
          x={center.x}
          y={center.y}
          color={puff.color}
          size={frame.size}
        />
      ))}
    </>
  );
}

const PUFF_MS = 700;
const SPARKS = 8;

/**
 * A puff where a bot vanished or appeared: a ring and a few sparks flying
 * out. CSS only (transform and opacity), played once, then removed.
 */
function Puff({
  x,
  y,
  color,
  size,
}: {
  x: number;
  y: number;
  color: string;
  size: number;
}) {
  const reach = Math.max(18, size * 0.75);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20"
      style={{ left: x, top: y }}
    >
      <span
        className="absolute rounded-full border-2"
        style={{
          width: size,
          height: size,
          left: -size / 2,
          top: -size / 2,
          borderColor: color,
          animation: `notch-ring ${PUFF_MS}ms ease-out forwards`,
        }}
      />
      {Array.from({ length: SPARKS }, (_, i) => {
        const angle = (i / SPARKS) * Math.PI * 2 + 0.3;
        const dot = i % 2 ? 4 : 6;
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={
              {
                width: dot,
                height: dot,
                left: -dot / 2,
                top: -dot / 2,
                background: i % 3 === 0 ? "#fff" : color,
                "--dx": `${Math.cos(angle) * reach}px`,
                "--dy": `${Math.sin(angle) * reach}px`,
                animation: `notch-spark ${PUFF_MS - 120}ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/**
 * A bot's face, drawn: a round body in its color, two eyes. For chips, rows
 * and stacks, where a live animation each would cost too much. Its eyes
 * blink while it works (CSS, on the compositor), smile when it's done, and
 * go flat when it failed.
 */
export function BotFace({
  bot,
  size,
  mood = "idle",
  className,
  style,
}: {
  bot: BotChoice;
  size: number;
  mood?: "idle" | "working" | "done" | "failed";
  className?: string;
  style?: CSSProperties;
}) {
  const color = colorOf(bot);
  const dark = bot === "nori";
  const eye = dark ? "#f4f4f6" : "#1b1b22";
  const w = Math.max(2, size * 0.12);
  const h = Math.max(3, size * 0.26);
  return (
    <span
      aria-hidden
      className={cn("relative inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 34% 28%, ${dark ? "#56566a" : "#ffffffaa"} 0%, ${color} 46%, ${color} 100%)`,
        boxShadow: `inset 0 -${Math.max(1, size * 0.08)}px ${size * 0.16}px rgba(0,0,0,0.22)`,
        ...style,
      }}
    >
      {[0.36, 0.64].map((at) => (
        <span
          key={at}
          className={cn("absolute", mood === "working" && "notch-loop")}
          style={{
            left: `${at * 100}%`,
            top: "54%",
            width: mood === "done" ? w * 1.9 : mood === "failed" ? w * 2 : w,
            height:
              mood === "done"
                ? w * 1.9
                : mood === "failed"
                  ? Math.max(2, w * 0.7)
                  : h,
            transform: "translate(-50%, -50%)",
            borderRadius: 999,
            ...(mood === "done"
              ? {
                  borderTop: `${Math.max(1.5, w * 0.6)}px solid ${eye}`,
                  background: "transparent",
                }
              : { background: eye }),
            animation:
              mood === "working"
                ? "notch-blink 3.2s ease-in-out infinite"
                : undefined,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Drag the bot out of the notch and let go on any window: Mali captures that
 * window for the ask box. The system drag image (a little bot) follows the
 * cursor across the whole screen, outside the notch's own window.
 */
function BotHandle({ bot, onBotDropped }: Props & { bot: BotChoice }) {
  const t = useNotchText();
  const image = useRef<HTMLCanvasElement | null>(null);
  // Ready before the drag starts: the drag image must be set synchronously.
  const prepare = (handle: HTMLElement) => {
    const frame = handle.parentElement?.querySelector<HTMLIFrameElement>(
      "iframe[data-cowork-bot]",
    );
    void botImage(frame, colorOf(bot)).then((canvas) => {
      image.current = canvas;
    });
  };
  return (
    <div
      draggable
      className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
      title={t("dragMe")}
      onPointerEnter={(event) => prepare(event.currentTarget)}
      onPointerDown={(event) => prepare(event.currentTarget)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", "mali-capture");
        const canvas = image.current ?? fallbackImage(colorOf(bot));
        if (canvas) {
          // WebKit takes a drag image from an element in the page.
          document.body.appendChild(canvas);
          event.dataTransfer.setDragImage(canvas, DRAG_SIZE / 2, DRAG_SIZE / 2);
          setTimeout(() => canvas.remove(), 0);
        }
      }}
      onDragEnd={() => onBotDropped()}
    />
  );
}

const DRAG_SIZE = 72;

function dragCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = DRAG_SIZE * 2;
  canvas.height = DRAG_SIZE * 2;
  canvas.style.cssText = `position:fixed;top:-300px;left:-300px;width:${DRAG_SIZE}px;height:${DRAG_SIZE}px`;
  const ctx = canvas.getContext("2d");
  ctx?.scale(2, 2);
  return { canvas, ctx };
}

/** A small camera on the bot's shoulder: letting go takes a picture. */
function cameraBadge(ctx: CanvasRenderingContext2D) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(DRAG_SIZE - 13, 13, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "13px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("📸", DRAG_SIZE - 13, 14);
}

/**
 * The bot itself, as the cursor carries it: its SVG, copied out of its
 * animation (same origin) in the pose it's in, with its glow and a camera.
 */
async function botImage(
  frame: HTMLIFrameElement | null | undefined,
  color: string,
) {
  const svg = frame?.contentDocument?.querySelector("svg");
  if (!svg) return null;
  let markup = new XMLSerializer()
    .serializeToString(svg)
    // Page variables don't reach an image: give them their dark-theme values.
    .replace(/var\(--shadow\)/g, "rgba(0,0,0,0.25)")
    .replace(/var\(--muted\)/g, "#9a9aa5");
  if (!markup.includes('xmlns="http://www.w3.org/2000/svg"')) {
    markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  markup = markup.replace(
    "<svg",
    `<svg width="${DRAG_SIZE * 2}" height="${DRAG_SIZE * 2}"`,
  );
  const picture = new Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  try {
    await picture.decode();
  } catch {
    return null;
  }
  const { canvas, ctx } = dragCanvas();
  if (!ctx) return null;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.drawImage(picture, 6, 6, DRAG_SIZE - 12, DRAG_SIZE - 12);
  cameraBadge(ctx);
  return canvas;
}

/** If the bot can't be copied: a little blob in its color with two eyes. */
function fallbackImage(color: string) {
  const { canvas, ctx } = dragCanvas();
  if (!ctx) return null;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(14, 18, 44, 40, 16);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#111";
  for (const x of [29, 43]) {
    ctx.beginPath();
    ctx.ellipse(x, 38, 3.2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  cameraBadge(ctx);
  return canvas;
}

/**
 * A cowork bot as a still picture (its own drawing, taken once and kept):
 * for chips and stacks, where a live animation each would cost too much.
 * The drawn face stands in until the picture is ready. A dot says it's
 * working; a check, that it's done.
 */
function BotPicture({
  bot,
  size,
  mood = "idle",
  className,
  style,
}: {
  bot: BotChoice;
  size: number;
  mood?: "idle" | "working" | "done" | "failed";
  className?: string;
  style?: CSSProperties;
}) {
  const picture = useBotPicture(bot);
  const dot = Math.max(7, Math.round(size * 0.3));
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size, ...style }}
    >
      {picture ? (
        <img
          src={picture}
          alt=""
          draggable={false}
          className="size-full"
          // The bot's blob, not a box, against what's behind it.
          style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.85))" }}
        />
      ) : (
        <BotFace bot={bot} size={size} mood={mood} />
      )}
      {mood !== "idle" && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-black",
            mood === "working" && "notch-loop",
          )}
          style={{
            width: dot,
            height: dot,
            background:
              mood === "working" ? BLUE : mood === "done" ? GREEN : RED,
            animation:
              mood === "working"
                ? "notch-fade 1.4s ease-in-out infinite"
                : undefined,
          }}
        />
      )}
    </span>
  );
}

const TONE: Record<NotchPeek["tone"], string> = {
  done: GREEN,
  failed: RED,
  team: BLUE,
  edit: "#8b5cf6",
};

/** A soft light behind the main bot; it breathes while there's work. */
function Glow({
  snapshot,
  view,
  bot,
  drop,
  peek,
}: Props & { bot: BotChoice }) {
  const big = view !== "collapsed" && view !== "chat" && view !== "sessions";
  const color =
    view === "permission"
      ? AMBER
      : view === "question"
        ? BLUE
        : view === "peek" && peek
          ? TONE[peek.tone]
          : view === "drop" || snapshot.phase === "done"
            ? GREEN
            : colorOf(bot);
  const breathing =
    big &&
    (snapshot.phase === "working" ||
      view === "welcome" ||
      (view === "drop" && drop === "over"));
  return (
    <motion.div
      aria-hidden
      className="absolute -inset-[45%]"
      initial={false}
      animate={big ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
      transition={{ duration: 0.3 }}
    >
      <div
        className={cn(
          "size-full rounded-full blur-2xl",
          breathing && "notch-loop",
        )}
        style={{
          background: color,
          opacity: 0.4,
          animation: breathing
            ? "notch-breathe 2.4s ease-in-out infinite"
            : undefined,
        }}
      />
    </motion.div>
  );
}

function Badges({ snapshot, view, peek }: Props) {
  const big = view === "home" || view === "permission";
  const tone = view === "peek" ? peek?.tone : undefined;
  return (
    <AnimatePresence>
      {view === "question" && (
        <Badge key="question" color={BLUE}>
          <span className="text-[13px] leading-none font-bold text-white">
            ?
          </span>
        </Badge>
      )}
      {big && snapshot.phase === "permission" && (
        <Badge key="alert" color={AMBER}>
          <span className="text-[13px] leading-none font-bold text-black">
            !
          </span>
        </Badge>
      )}
      {big && snapshot.phase === "working" && (
        <Badge key="busy" color={BLUE}>
          <Dots />
        </Badge>
      )}
      {tone === "done" && (
        <Badge key="peek-done" color={GREEN}>
          <CheckIcon className="size-3.5 text-black" strokeWidth={3} />
        </Badge>
      )}
      {tone === "failed" && <Badge key="peek-failed" color={RED} small />}
      {tone === "team" && (
        <Badge key="peek-team" color={BLUE}>
          <Dots />
        </Badge>
      )}
      {tone === "edit" && (
        <Badge key="peek-edit" color={TONE.edit}>
          <PencilIcon className="size-3 text-white" strokeWidth={2.5} />
        </Badge>
      )}
    </AnimatePresence>
  );
}

function Badge({
  color,
  children,
  small,
}: {
  color: string;
  children?: ReactNode;
  small?: boolean;
}) {
  return (
    <motion.div
      className={cn(
        "absolute -top-1 -left-1 flex items-center justify-center rounded-full ring-2 ring-black",
        small ? "size-4" : "size-6",
      )}
      style={{ background: color }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: 1,
        transition: {
          delay: 0.18,
          type: "spring",
          stiffness: 520,
          damping: 18,
        },
      }}
      exit={{ scale: 0, opacity: 0, transition: { duration: 0.12 } }}
    >
      {children}
    </motion.div>
  );
}

/** Three dots taking turns: the agent is busy. */
function Dots() {
  return (
    <span className="flex items-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="notch-loop size-[3px] rounded-full bg-white"
          style={{
            animation: `notch-dim 1s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ── collapsed ──

/** The current step: the one still running, or else the last one. */
function currentStepIndex(steps: NotchStep[]) {
  for (let i = steps.length - 1; i >= 0; i--) if (!steps[i].done) return i;
  return steps.length - 1;
}

function stepText(snapshot: NotchSnapshot, t: NotchText) {
  if (snapshot.phase === "idle") return t("askMali");
  if (snapshot.phase === "done") return t("done");
  if (snapshot.phase === "permission") return t("needsPermissionShort");
  if (snapshot.question) return t("hasQuestion");
  return (
    snapshot.steps[currentStepIndex(snapshot.steps)]?.title ?? t("working")
  );
}

/**
 * The bot on the left wing, a status on the right; the step in between
 * without a notch, and in a row under the camera with one.
 */
function Collapsed({ snapshot, geometry, chatBusy }: Props) {
  const t = useNotchText();
  const text = (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p
        key={stepText(snapshot, t)}
        className="truncate text-center text-[12px] font-medium text-white/80"
        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
      >
        {stepText(snapshot, t)}
      </motion.p>
    </AnimatePresence>
  );
  return (
    <div className="flex h-full cursor-pointer flex-col">
      <div
        className="flex shrink-0 items-center"
        style={{ height: barOf(geometry) }}
      >
        <div style={{ width: WING }} className="shrink-0" />
        <div className="min-w-0 flex-1 px-1">{!geometry.hasNotch && text}</div>
        <div
          style={{ width: WING }}
          className="flex shrink-0 items-center justify-center pr-1"
        >
          <Indicator snapshot={snapshot} chatBusy={chatBusy} />
        </div>
      </div>
      {geometry.hasNotch && (
        <div className="flex min-w-0 flex-1 items-center overflow-hidden px-3 pb-1">
          <div className="min-w-0 flex-1">{text}</div>
        </div>
      )}
    </div>
  );
}

function indicatorOf(snapshot: NotchSnapshot, chatBusy?: boolean) {
  if (snapshot.phase === "idle") return chatBusy ? "busy" : "idle";
  if (snapshot.phase === "done") return "done";
  if (snapshot.phase === "permission") return "ask";
  if (snapshot.question) return "question";
  if (snapshot.team.some((m) => !m.done)) return "team";
  if (snapshot.todos.length) return "todos";
  return "busy";
}

function Indicator({
  snapshot,
  chatBusy,
}: {
  snapshot: NotchSnapshot;
  chatBusy?: boolean;
}) {
  const kind = indicatorOf(snapshot, chatBusy);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={kind}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.4, opacity: 0 }}
        className="flex items-center justify-center"
      >
        {kind === "done" && (
          <span
            className="flex size-[18px] items-center justify-center rounded-full"
            style={{ background: GREEN }}
          >
            <CheckIcon className="size-3 text-black" strokeWidth={3} />
          </span>
        )}
        {kind === "ask" && (
          <span
            className="notch-loop flex size-[18px] items-center justify-center rounded-full text-[11px] font-bold text-black"
            style={{
              background: AMBER,
              animation: "notch-beat 1.2s ease-in-out infinite",
            }}
          >
            !
          </span>
        )}
        {kind === "question" && (
          <span
            className="notch-loop flex size-[18px] items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{
              background: BLUE,
              animation: "notch-beat 1.2s ease-in-out infinite",
            }}
          >
            ?
          </span>
        )}
        {kind === "team" && <TeamDots mates={snapshot.team} />}
        {kind === "todos" && <Ring todos={snapshot.todos} />}
        {kind === "busy" && <Bars />}
        {kind === "idle" && <SparklesIcon className="size-3.5 text-white/45" />}
      </motion.div>
    </AnimatePresence>
  );
}

/** Up to four bots as colored dots; the ones still working pulse. */
function TeamDots({ mates }: { mates: NotchMate[] }) {
  return (
    <div className="grid grid-cols-2 gap-[3px]">
      {mates.slice(0, 4).map((mate, i) => (
        <span
          key={mate.id}
          className={cn("size-[8px] rounded-full", !mate.done && "notch-loop")}
          style={{
            background: mate.color,
            opacity: mate.done ? 0.45 : 1,
            animation: mate.done
              ? undefined
              : `notch-shrink 1.1s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function isDone(todo: TodoItem) {
  return !!todo.done || todo.status === "completed" || todo.status === "done";
}

function isActive(todo: TodoItem) {
  return (
    !isDone(todo) &&
    (todo.status === "in_progress" || todo.status === "inProgress")
  );
}

/** How far through its plan the agent is. */
function Ring({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter(isDone).length;
  const r = 7;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90">
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="2.5"
      />
      <motion.circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={length}
        initial={false}
        animate={{
          strokeDashoffset: length * (1 - done / Math.max(todos.length, 1)),
        }}
      />
    </svg>
  );
}

/** A little equalizer: working, with nothing more specific to show. */
function Bars() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]">
      {[0, 1, 2].map((i) => (
        // Scaled, not resized: the compositor plays it without layout or script.
        <span
          key={i}
          className="notch-loop h-full w-[3px] origin-bottom rounded-full bg-white/80"
          style={{
            animation: `notch-bar 0.9s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ── home ──

function boxStyle(b: Box): CSSProperties {
  return { left: b.x, top: b.y, width: b.width, height: b.height };
}

function Home(props: Props) {
  const { snapshot, geometry, shape, roster } = props;
  // The right card is the team (a CTA to make one when there's none), or the
  // plan while a run without a team has one.
  const side =
    roster.length === 0 && snapshot.todos.length > 0 ? "todos" : "team";
  const { left, right } = homeCards(geometry, shape, true);
  return (
    <>
      <div
        className="absolute overflow-hidden rounded-[22px] bg-white/[0.06]"
        style={boxStyle(left)}
      >
        <LeftPager {...props} />
      </div>
      <div
        className="absolute rounded-[22px] bg-white/[0.06]"
        style={boxStyle(right!)}
      >
        {side === "todos" && <Todos todos={snapshot.todos} />}
      </div>
      {side === "team" && <TeamCard {...props} card={right!} />}
    </>
  );
}

const PAGES = ["main", "usage", "settings", "recap"] as const;
/** The dot of the page in view, like a slide deck's. */
const PAGE_DOT = "#0a84ff";
/** Pages glide on the compositor (a transform), settling without a bounce. */
const PAGE_SPRING: Transition = {
  type: "spring",
  stiffness: 340,
  damping: 34,
  mass: 0.85,
};
/** How far a turn has to go before it turns the page (px of wheel / trackpad). */
const WHEEL_STEP_THRESHOLD = 28;
/** A pause this long ends a gesture: the next turn is a new one. */
const WHEEL_GESTURE_GAP_MS = 160;
/** A fresh swipe can rise out of the last one's momentum only after this long. */
const WHEEL_MIN_TURN_MS = 260;

/**
 * One wheel / trackpad gesture turns one page, however long its momentum
 * runs on. A gesture ends with a pause, or when a fresh swipe rises out of
 * the dying momentum (its deltas grow again).
 */
function wheelPager(step: (dir: -1 | 1) => void) {
  let sum = 0;
  let last = 0;
  let lastSize = 0;
  let turnedAt = 0;
  let locked = false;
  return (deltaY: number) => {
    const now = performance.now();
    const gap = now - last;
    const size = Math.abs(deltaY);
    const rising =
      now - turnedAt > WHEEL_MIN_TURN_MS && size > 8 && size > lastSize * 1.6;
    last = now;
    lastSize = size;
    if (gap > WHEEL_GESTURE_GAP_MS || (locked && rising)) {
      locked = false;
      sum = 0;
    }
    if (locked) return;
    // Turning back mid-gesture starts the count over.
    if (Math.sign(deltaY) !== Math.sign(sum)) sum = 0;
    sum += deltaY;
    if (Math.abs(sum) < WHEEL_STEP_THRESHOLD) return;
    const dir = sum > 0 ? 1 : -1;
    locked = true;
    turnedAt = now;
    sum = 0;
    step(dir);
  };
}

/**
 * Home's left card as pages to scroll through, one at a time: the run (or
 * a greeting), how much Cowork did today, a few settings, and the week's
 * recap. Dots down the right say which; tap one to go there. Past the
 * first page the bot steps into the corner to make room.
 */
function LeftPager(props: Props) {
  const { snapshot, slide = 0, onSlide } = props;
  const card = useRef<HTMLDivElement>(null);
  const [edge, animateEdge] = useAnimate<HTMLDivElement>();
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const onSlideRef = useRef(onSlide);
  onSlideRef.current = onSlide;
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let hovered = false;
    const turn = wheelPager((dir) => {
      const next = slideRef.current + dir;
      if (next < 0 || next >= PAGES.length) {
        // Past the first or last page: a little give, then back.
        if (edge.current) {
          void animateEdge(
            edge.current,
            { y: [0, -dir * 10, 0] },
            { duration: 0.42, ease: [0.3, 0.7, 0.4, 1] },
          );
        }
        return;
      }
      slideRef.current = next;
      onSlideRef.current?.(next);
    });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Lines (some mice) to pixels, so the threshold means the same.
      turn(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY);
    };
    const onEnter = () => (hovered = true);
    const onLeave = () => (hovered = false);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    // Windows: the same turn may come from Rust too; one gesture still turns once.
    const stopWheel = onNotchWheel((deltaY) => hovered && turn(deltaY));
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      stopWheel();
    };
  }, [edge, animateEdge]);
  return (
    <>
      <div ref={card} className="absolute inset-0 overflow-hidden">
        <div ref={edge} className="absolute inset-0">
          <motion.div
            className="absolute inset-0 will-change-transform"
            initial={false}
            animate={{ y: `${-slide * 100}%` }}
            transition={PAGE_SPRING}
          >
            {PAGES.map((page, i) => (
              <section
                key={page}
                className="absolute inset-x-0 h-full"
                style={{ top: `${i * 100}%` }}
                aria-hidden={i !== slide}
                inert={i !== slide}
              >
                {page === "main" &&
                  (snapshot.phase === "idle" ? (
                    <Greeting {...props} />
                  ) : (
                    <RunLines {...props} />
                  ))}
                {page === "usage" && <UsagePage {...props} />}
                {page === "settings" && <SettingsPage />}
                {page === "recap" && <RecapPage {...props} />}
              </section>
            ))}
          </motion.div>
        </div>
      </div>
      <div className="absolute top-1/2 right-[9px] flex -translate-y-1/2 flex-col gap-[7px]">
        {PAGES.map((page, i) => (
          <button
            key={page}
            type="button"
            title={page}
            onClick={() => onSlide?.(i)}
            className="relative size-[7px] rounded-full"
            style={{ background: "rgba(255,255,255,0.18)" }}
          >
            {i === slide && (
              // One dot slides between the pages, like the pages themselves.
              <motion.span
                layoutId="notch-page-dot"
                className="absolute -inset-[0.5px] rounded-full"
                style={{ background: PAGE_DOT }}
                transition={PAGE_SPRING}
              />
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/** A page's title, beside the bot in the corner. */
function PageTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex h-[44px] items-center gap-2 pr-7 pl-[46px]">
      <span className="truncate text-[11px] font-medium tracking-wide text-white/45 uppercase">
        {children}
      </span>
      {aside && (
        <span className="ml-auto shrink-0 text-[11px] text-white/35">
          {aside}
        </span>
      )}
    </div>
  );
}

function compact(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function money(cost: number) {
  return cost >= 1
    ? `$${cost.toFixed(2)}`
    : `$${cost.toFixed(cost >= 0.1 ? 2 : 3)}`;
}

/** How much Cowork did today — runs, time, files — and runs a day this week. */
function UsagePage({ usage }: Props) {
  const t = useNotchText();
  if (!usage) {
    return (
      <>
        <PageTitle>{t("usageTitle")}</PageTitle>
        <div className="flex h-[90px] items-center justify-center text-white/35">
          <Loader2Icon className="size-4 animate-spin" />
        </div>
      </>
    );
  }
  const most = Math.max(1, ...usage.days);
  const stats = [
    { value: String(usage.runs), label: t("usageRuns") },
    {
      value: usage.seconds ? spoken(usage.seconds) : "0s",
      label: t("usageTime"),
    },
    { value: String(usage.files), label: t("usageFiles") },
  ];
  return (
    <>
      <PageTitle
        aside={
          usage.tokens
            ? `${compact(usage.tokens)} tok${usage.cost ? ` · ${money(usage.cost)}` : ""}`
            : undefined
        }
      >
        {t("usageTitle")}
      </PageTitle>
      <div className="grid grid-cols-3 gap-1.5 pr-7 pl-3.5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl bg-white/[0.05] px-2 py-1.5"
          >
            <p className="truncate text-[16px] leading-tight font-semibold text-white tabular-nums">
              {stat.value}
            </p>
            <p className="truncate text-[10px] text-white/40">{stat.label}</p>
          </div>
        ))}
      </div>
      <div
        className="mt-2.5 flex items-end gap-1 pr-7 pl-3.5"
        style={{ height: 34 }}
        title={t("usageWeek")}
      >
        {usage.days.map((runs, i) => (
          <motion.span
            key={i}
            className="flex-1 origin-bottom rounded-[3px]"
            style={{
              height: Math.max(3, (runs / most) * 34),
              background:
                i === usage.days.length - 1
                  ? PAGE_DOT
                  : "rgba(255,255,255,0.16)",
            }}
            initial={{ scaleY: 0 }}
            animate={{
              scaleY: 1,
              transition: {
                delay: 0.05 + i * 0.03,
                type: "spring",
                stiffness: 300,
                damping: 24,
              },
            }}
          />
        ))}
      </div>
      <p className="mt-1 pr-7 pl-3.5 text-[10px] text-white/30">
        {t("usageWeek")}
      </p>
    </>
  );
}

/** A row of choices, small enough for the notch. */
function Pills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="flex shrink-0 rounded-full bg-white/[0.06] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 rounded-full px-2 text-[11px] transition-colors",
            option.value === value
              ? "bg-white font-medium text-black"
              : "text-white/55 hover:text-white",
          )}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** A few of Settings → Notch, a scroll away: the look, keeping chats, the screen. */
function SettingsPage() {
  const t = useNotchText();
  const look = useNotchLook();
  const save = useNotchSaveChats();
  const screen = useNotchScreen();
  return (
    <>
      <PageTitle>{t("quickSettings")}</PageTitle>
      <div className="flex flex-col gap-1.5 pr-7 pl-3.5 text-[12px] text-white/75">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{t("lookLabel")}</span>
          <Pills
            value={look}
            onChange={setNotchLook}
            options={[
              { value: "black", label: t("lookBlack") },
              { value: "light", label: t("lookLight") },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{t("saveChats")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={save}
            onClick={() => setNotchSaveChats(!save)}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
              save ? "bg-[#0a84ff]" : "bg-white/20",
            )}
          >
            <motion.span
              className="absolute top-0.5 size-4 rounded-full bg-white shadow"
              initial={false}
              animate={{ left: save ? 18 : 2 }}
            />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{t("screenLabel")}</span>
          <Pills
            value={screen}
            onChange={setNotchScreenPref}
            options={[
              { value: "follow", label: t("screenFollow") },
              { value: "builtin", label: t("screenMac") },
              { value: "main", label: t("screenMain") },
            ]}
          />
        </div>
      </div>
    </>
  );
}

const SAVED = { ink: "#f5b53d", ground: "rgba(245,165,36,0.13)" } as const;

/** "23 hr 56 min", "33 min": a length of time, read out. */
function lasting(minutes: number, t: NotchText) {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60
    ? t("hoursMinutes", { h: Math.floor(m / 60), m: m % 60 })
    : t("minutesOnly", { m });
}

/** Tasks a day, Monday first, as columns; today's (this week) stands out. */
function DayColumns({
  days,
  week,
  height,
  labels,
}: {
  days: number[];
  week: number;
  height: number;
  labels?: boolean;
}) {
  const most = Math.max(1, ...days);
  const today = week === 0 ? (new Date().getDay() + 6) % 7 : -1;
  const names = labels ? weekdayNames() : [];
  return (
    <div className="flex items-end gap-[5px]">
      {days.map((tasks, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div className="flex items-end" style={{ height }}>
            <motion.span
              className="block w-[9px] origin-bottom rounded-[3px]"
              style={{
                height: Math.max(3, (tasks / most) * height),
                background:
                  i === today
                    ? SAVED.ink
                    : tasks
                      ? "rgba(255,255,255,0.55)"
                      : "rgba(255,255,255,0.14)",
              }}
              title={`${tasks}`}
              initial={{ scaleY: 0 }}
              animate={{
                scaleY: 1,
                transition: {
                  delay: 0.06 + i * 0.035,
                  type: "spring",
                  stiffness: 300,
                  damping: 24,
                },
              }}
            />
          </div>
          {labels && (
            <span className="text-[9px] leading-none text-white/35">
              {names[i]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** M T W T F S S, in the app's language. */
function weekdayNames() {
  const monday = new Date(2026, 8, 28);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + i,
    ).toLocaleDateString(undefined, {
      weekday: "narrow",
    }),
  );
}

/** Home's last page: this week's time saved and tasks a day; tap for the whole recap. */
function RecapPage({ recap, onRecap }: Props) {
  const t = useNotchText();
  const rates = useNotchRates();
  return (
    <>
      <PageTitle aside={t("thisWeek")}>{t("recapTitle")}</PageTitle>
      {!recap ? (
        <div className="flex h-[90px] items-center justify-center text-white/35">
          <Loader2Icon className="size-4 animate-spin" />
        </div>
      ) : (
        <motion.button
          type="button"
          onClick={onRecap}
          title={t("seeWeek")}
          className="absolute top-[44px] right-7 bottom-3 left-3.5 flex flex-col justify-between rounded-2xl px-3 py-2 text-left"
          style={{ background: SAVED.ground }}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.98 }}
        >
          <span
            className="flex items-center gap-1 text-[10.5px] font-medium"
            style={{ color: SAVED.ink }}
          >
            <ZapIcon className="size-3" />
            {t("timeSaved")}
          </span>
          <span className="flex items-end justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[20px] leading-tight font-bold text-white tabular-nums">
                ~{lasting(minutesSaved(recap, rates), t)}
              </span>
              <span className="truncate text-[10.5px] text-white/50">
                {t("recapLineShort", {
                  tasks: recap.tasks,
                  files: recap.created + recap.edited,
                })}
              </span>
            </span>
            <DayColumns days={recap.days} week={recap.week} height={26} />
          </span>
        </motion.button>
      )}
    </>
  );
}

/**
 * The weekly recap: the week (and the ones before it), the time saved by
 * the estimate, tasks a day, the tiles — tasks, files, agent time, cost —
 * and tasks per model. The estimate's minutes can be adjusted right here.
 */
function Recap({ geometry, recap, onHome, onRecapWeek }: Props) {
  const t = useNotchText();
  const rates = useNotchRates();
  const [adjusting, setAdjusting] = useState(false);
  const top = topRowOf(geometry);
  if (!recap) {
    return (
      <div
        className="absolute inset-x-3 bottom-3 flex items-center justify-center text-white/40"
        style={{ top }}
      >
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    );
  }
  const date = (at: number) =>
    new Date(at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const last = new Date(recap.to);
  last.setDate(last.getDate() - 1);
  const label =
    recap.week === 0
      ? t("thisWeek")
      : recap.week === 1
        ? t("lastWeek")
        : t("weeksAgo", { n: recap.week });
  const files = recap.created + recap.edited;
  const tiles = [
    {
      label: t("tileTasks"),
      value: String(recap.tasks),
      sub: t("tileChats", { n: recap.chats }),
    },
    {
      label: t("tileFiles"),
      value: String(files),
      sub: t("filesSub", { created: recap.created, edited: recap.edited }),
    },
    {
      label: t("agentTime"),
      value: lasting(recap.seconds / 60, t),
      sub: t("commandsSub", { n: recap.commands }),
    },
    {
      label: t("costLabel"),
      value: recap.cost ? money(recap.cost) : "$0",
      sub: recap.tokens
        ? t("tokensSub", { n: compact(recap.tokens) })
        : undefined,
    },
  ];
  const rateRows: { key: keyof typeof rates; label: string; step: number }[] = [
    { key: "task", label: t("rateTask"), step: 1 },
    { key: "created", label: t("rateCreated"), step: 1 },
    { key: "edited", label: t("rateEdited"), step: 1 },
    { key: "command", label: t("rateCommand"), step: 0.5 },
  ];
  return (
    <div className="absolute inset-x-3 bottom-3 flex flex-col" style={{ top }}>
      {/* The bot sits at the header's start (`mascotFrame`). */}
      <div
        className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center"
        style={{ height: RECAP.header }}
      >
        <span className="flex min-w-0 items-center gap-1.5 pl-9 text-[15px] font-semibold text-white">
          <ZapIcon className="size-4 shrink-0" style={{ color: SAVED.ink }} />
          <span className="truncate">{t("recapTitle")}</span>
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            title={t("previousWeek")}
            onClick={() => onRecapWeek?.(Math.min(recap.week + 1, 51))}
            className="flex size-7 items-center justify-center rounded-full text-white/70 hover:bg-white/[0.08] hover:text-white"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <span className="flex min-w-[150px] flex-col items-center leading-tight">
            <span className="text-[13px] font-semibold text-white">
              {label}
            </span>
            <span className="text-[11px] text-white/45 tabular-nums">
              {date(recap.from)} – {date(last.getTime())}
            </span>
          </span>
          <button
            type="button"
            title={t("nextWeek")}
            disabled={recap.week === 0}
            onClick={() => onRecapWeek?.(Math.max(recap.week - 1, 0))}
            className="flex size-7 items-center justify-center rounded-full text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </span>
        <span className="flex justify-end">
          <button
            type="button"
            onClick={onHome}
            title={t("close")}
            className="flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.08] hover:text-white"
          >
            <XIcon className="size-4" />
          </button>
        </span>
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={recap.week}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
        >
          <div
            className="flex shrink-0 items-center justify-between gap-4 rounded-[20px] px-4"
            style={{ height: RECAP.hero, background: SAVED.ground }}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className="text-[12px] font-medium"
                style={{ color: SAVED.ink }}
              >
                {t("timeSaved")}
              </span>
              <span className="truncate text-[30px] leading-tight font-bold text-white tabular-nums">
                ~{lasting(minutesSaved(recap, rates), t)}
              </span>
              <span className="truncate text-[12px] text-white/55">
                {t("savedLine", {
                  tasks: recap.tasks,
                  created: recap.created,
                  edited: recap.edited,
                  commands: recap.commands,
                })}
              </span>
            </div>
            <DayColumns
              days={recap.days}
              week={recap.week}
              height={44}
              labels
            />
          </div>
          <div
            className="mt-2.5 grid shrink-0 grid-cols-4 gap-2"
            style={{ height: RECAP.tiles }}
          >
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="flex min-w-0 flex-col rounded-2xl bg-white/[0.05] px-3 py-2"
              >
                <span className="truncate text-[11px] text-white/50">
                  {tile.label}
                </span>
                <span className="truncate text-[19px] leading-tight font-semibold text-white tabular-nums">
                  {tile.value}
                </span>
                {tile.sub && (
                  <span className="truncate text-[10.5px] text-white/40">
                    {tile.sub}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex min-h-0 flex-col">
            <span className="h-5 text-[11px] text-white/45">
              {t("modelsLabel")}
            </span>
            {recap.models.length === 0 ? (
              <span
                className="text-[12px] text-white/35"
                style={{ height: RECAP.model }}
              >
                {t("recapNone")}
              </span>
            ) : (
              recap.models.map((model, i) => (
                <div
                  key={model.name}
                  className="flex flex-col justify-center gap-1"
                  style={{ height: RECAP.model }}
                >
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <span className="size-2 shrink-0 rounded-[2px] bg-white/70" />
                    <span className="min-w-0 truncate text-white/85">
                      {model.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[11.5px] text-white/45 tabular-nums">
                      {t("modelTasks", { n: model.tasks })}
                    </span>
                  </span>
                  <span className="h-[5px] overflow-hidden rounded-full bg-white/[0.08]">
                    <motion.span
                      className="block h-full rounded-full bg-white/75"
                      initial={{ width: 0 }}
                      animate={{
                        width: `${(model.tasks / Math.max(1, recap.tasks)) * 100}%`,
                        transition: {
                          delay: 0.1 + i * 0.06,
                          type: "spring",
                          stiffness: 160,
                          damping: 24,
                        },
                      }}
                    />
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </AnimatePresence>
      <div
        className="mt-auto flex shrink-0 items-center gap-2 text-[11px] text-white/40"
        style={{ height: RECAP.foot }}
      >
        {adjusting ? (
          <>
            {/* Steppers, not boxes to type in: the notch doesn't take the keyboard here. */}
            {rateRows.map((row) => (
              <span key={row.key} className="flex min-w-0 items-center gap-1">
                <span className="flex shrink-0 items-center rounded-full bg-white/[0.08]">
                  <button
                    type="button"
                    title="−"
                    onClick={() =>
                      setNotchRates({
                        ...rates,
                        [row.key]: rates[row.key] - row.step,
                      })
                    }
                    className="flex size-5 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.12] hover:text-white"
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-[11px] text-white tabular-nums">
                    {rates[row.key]}
                  </span>
                  <button
                    type="button"
                    title="+"
                    onClick={() =>
                      setNotchRates({
                        ...rates,
                        [row.key]: rates[row.key] + row.step,
                      })
                    }
                    className="flex size-5 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.12] hover:text-white"
                  >
                    +
                  </button>
                </span>
                <span className="truncate">{row.label}</span>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setAdjusting(false)}
              className="ml-auto shrink-0 rounded-full bg-white/[0.1] px-2.5 py-0.5 text-white/80 hover:bg-white/[0.16]"
            >
              {t("done")}
            </button>
          </>
        ) : (
          <span className="truncate">
            {t("recapFoot")}{" "}
            <button
              type="button"
              onClick={() => setAdjusting(true)}
              className="underline underline-offset-2 hover:text-white/70"
            >
              {t("adjustEstimate")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/** Nothing running: who's here and how to ask. */
function Greeting({ active, onChat }: Props) {
  const t = useNotchText();
  return (
    <div className="absolute inset-y-0 right-6 left-[120px] flex flex-col justify-center gap-1.5">
      <p className="truncate text-[15px] font-semibold text-white">
        {t("greeting", { name: active.name })}
      </p>
      <p className="text-[12px] leading-snug text-white/50">
        {t("greetingBody")}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={onChat}
          className="flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-black transition-transform active:scale-95"
        >
          <SparklesIcon className="size-3.5" />
          {t("ask")}
        </button>
        <span className="flex items-center gap-1 text-[11px] text-white/40">
          <kbd className="rounded border border-white/15 px-1 font-sans">
            ⌥⌘M
          </kbd>{" "}
          {t("anywhere")}
        </span>
      </div>
    </div>
  );
}

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * The run: who's on it and where, the step before (dim), the one it's on
 * (bright, up to two lines), what comes next, and how long it has been at it.
 */
function RunLines(props: Props) {
  const { snapshot, active, onOpenChat } = props;
  const t = useNotchText();
  const where = snapshot.folder ? folderName(snapshot.folder) : snapshot.title;
  return (
    <div className="absolute inset-y-0 right-6 left-[120px] flex flex-col justify-center gap-1.5 py-3">
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-white/45">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={active.key}
            className="shrink-0 font-semibold text-white/75"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          >
            {active.name}
          </motion.span>
        </AnimatePresence>
        {where && <span className="min-w-0 truncate">· {where}</span>}
        <button
          type="button"
          onClick={onOpenChat}
          title={t("openInMali")}
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/60 hover:bg-white/[0.16] hover:text-white"
        >
          <ArrowUpRightIcon className="size-3" />
        </button>
      </div>
      <RollingSteps snapshot={snapshot} />
      <StatusChip snapshot={snapshot} />
    </div>
  );
}

/** Seconds since `since`, ticking once a second while `live` (and only then). */
function useElapsed(since: number | undefined, live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live || !since) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : undefined;
}

function spoken(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "working · 9s", "needs you", "done": the run in a word, in its color. */
function StatusChip({ snapshot }: { snapshot: NotchSnapshot }) {
  const t = useNotchText();
  const working = snapshot.phase === "working";
  const elapsed = useElapsed(snapshot.startedAt, working);
  const [label, color] =
    snapshot.phase === "permission"
      ? [t("needsYou"), AMBER]
      : snapshot.question
        ? [t("needsYou"), BLUE]
        : snapshot.phase === "done"
          ? [
              snapshot.failed ? t("failedShort") : t("done"),
              snapshot.failed ? RED : GREEN,
            ]
          : [
              elapsed !== undefined
                ? `${t("workingShort")} · ${spoken(elapsed)}`
                : t("workingShort"),
              BLUE,
            ];
  return (
    <span
      className="mt-0.5 w-fit rounded-full px-2.5 py-0.5 text-[11.5px] font-medium tabular-nums"
      style={{ background: `${color}24`, color }}
    >
      {label}
    </span>
  );
}

export function iconOf(step: { kind: string; title: string }): LucideIcon {
  const verb = step.title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/^(question|ask)/.test(verb)) return CircleHelpIcon;
  if (/^(run|bash|shell|exec|command)/.test(verb)) return TerminalIcon;
  if (/^(read|list|find|glob|open)/.test(verb)) return FileTextIcon;
  if (/^(write|edit|patch|update|create|copy|save)/.test(verb))
    return PencilIcon;
  if (/^(search|grep)/.test(verb)) return SearchIcon;
  if (/^(fetch|web)/.test(verb)) return GlobeIcon;
  if (step.kind === "system") return SparklesIcon;
  return HammerIcon;
}

type Row = {
  key: string;
  title: string;
  icon: LucideIcon;
  tone: "past" | "now" | "next";
  spin?: boolean;
};

/**
 * Lines that roll upward as the agent moves on: the step before (dim), the
 * one it's on (bright), and what its plan says comes next (dim).
 */
function rowsOf(snapshot: NotchSnapshot, t: NotchText): Row[] {
  const { steps } = snapshot;
  const at = currentStepIndex(steps);
  const rows: Row[] = [];
  const past = snapshot.phase === "done" ? steps.at(-1) : steps[at - 1];
  if (past)
    rows.push({
      key: past.id,
      title: past.title,
      icon: CheckIcon,
      tone: "past",
    });
  if (snapshot.phase === "done") {
    rows.push({
      key: "done",
      title: snapshot.failed ?? t("taskFinished"),
      icon: CheckIcon,
      tone: "now",
    });
    return rows;
  }
  const now = steps[at];
  if (snapshot.question) {
    rows.push({
      key: `question:${snapshot.question.id}`,
      title: t("askingYou"),
      icon: CircleHelpIcon,
      tone: "now",
    });
    return rows;
  }
  rows.push(
    now
      ? {
          key: now.id,
          title: now.title,
          icon: iconOf(now),
          tone: "now",
          spin: !now.done,
        }
      : {
          key: "start",
          title: t("startWorking"),
          icon: SparklesIcon,
          tone: "now",
          spin: true,
        },
  );
  const next = snapshot.todos.find((t) => !isDone(t) && !isActive(t));
  if (next)
    rows.push({
      key: `next:${next.id ?? next.text}`,
      title: next.text,
      icon: CircleIcon,
      tone: "next",
    });
  return rows;
}

function RollingSteps({ snapshot }: { snapshot: NotchSnapshot }) {
  const t = useNotchText();
  const rows = rowsOf(snapshot, t);
  return (
    <div className="flex flex-col gap-1 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        {rows.map((row) => {
          const now = row.tone === "now";
          return (
            <motion.div
              layout
              key={row.key}
              className={cn(
                "flex min-w-0 items-start gap-2",
                now
                  ? "text-[15px] leading-snug font-medium text-white"
                  : "text-[12.5px] text-white/40",
              )}
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
            >
              <span
                className={cn(
                  "flex w-3.5 shrink-0 justify-center",
                  now ? "mt-[3px]" : "mt-[2px]",
                )}
              >
                {row.tone === "past" ? (
                  <CheckIcon className="size-3" />
                ) : row.tone === "next" ? (
                  <CircleIcon className="size-2 fill-current" />
                ) : row.spin ? (
                  <Loader2Icon className="size-3.5 animate-spin text-white/60" />
                ) : (
                  <row.icon className="size-3.5" />
                )}
              </span>
              <span className={now ? "line-clamp-2 break-words" : "truncate"}>
                {row.title}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function chipMoodState(
  mood?: "idle" | "working" | "done" | "failed",
): BotState {
  if (mood === "working") return "working";
  if (mood === "done") return "done";
  if (mood === "failed") return "alert";
  return "idle";
}

/**
 * A chip's bot. A team bot on stage (in the main spot) leaves a dashed ring
 * here; when it comes back, or when `pulse` changes (the lead stepping
 * aside), it pops in with a puff.
 */
function ChipFace({
  bot,
  size,
  away,
  mood,
  pulse,
  cowork,
  paused,
}: {
  bot: BotChoice;
  size: number;
  away?: boolean;
  mood?: "idle" | "working" | "done" | "failed";
  pulse?: string;
  /** The animated cowork bot (iframe), not its still picture. */
  cowork?: boolean;
  /** The animated bot rests (a still frame): it's already animating elsewhere. */
  paused?: boolean;
}) {
  const [puff, setPuff] = useState(0);
  const was = useRef(`${away}:${pulse}`);
  useEffect(() => {
    const now = `${away}:${pulse}`;
    if (was.current === now) return;
    was.current = now;
    setPuff(Date.now());
    const timer = setTimeout(() => setPuff(0), PUFF_MS);
    return () => clearTimeout(timer);
  }, [away, pulse]);
  const color = colorOf(bot);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <AnimatePresence initial={false} mode="popLayout">
        {away ? (
          <motion.span
            key="away"
            className="absolute inset-0 rounded-full border-[1.5px] border-dashed"
            style={{ borderColor: `${color}bb` }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, transition: { delay: VANISH_S } }}
            exit={{
              scale: 0.4,
              opacity: 0,
              transition: { duration: VANISH_S },
            }}
          />
        ) : (
          <motion.span
            key={`here:${pulse ?? ""}`}
            className="absolute inset-0"
            initial={{ scale: 0, rotate: -30 }}
            animate={{
              scale: 1,
              rotate: 0,
              transition: {
                type: "spring",
                stiffness: 520,
                damping: 17,
                delay: VANISH_S,
              },
            }}
            exit={{ scale: 0, rotate: 30, transition: { duration: VANISH_S } }}
          >
            {cowork ? (
              <CoworkBot
                bot={bot}
                size={size}
                state={chipMoodState(mood)}
                theme="dark"
                paused={paused}
              />
            ) : (
              <BotPicture bot={bot} size={size} mood={mood} />
            )}
          </motion.span>
        )}
      </AnimatePresence>
      {puff > 0 && (
        <Puff key={puff} x={size / 2} y={size / 2} color={color} size={size} />
      )}
    </span>
  );
}

function moodOf(run: NotchMate | undefined): "idle" | "working" | "done" {
  return !run ? "idle" : run.done ? "done" : "working";
}

/**
 * The team: "Ask" and "New bot" along the top, the lead's chip, then the
 * team as one row — its faces stacked, who's working — that opens into a
 * chip per bot. Tap a chip to ask that bot directly. With no bots, the card
 * invites making one.
 */
function TeamCard(props: Props & { card: Box }) {
  const {
    roster,
    snapshot,
    active,
    lead,
    card,
    teamOpen,
    onTeamOpen,
    onPickBot,
    onAddBot,
  } = props;
  const t = useNotchText();
  const slots = teamSlots(card, roster.length, !!teamOpen);
  const leadName = useResolvedBot(lead).name;
  const working = snapshot.team.filter((m) => !m.done);
  const shown = roster.slice(0, TEAM_SHOWN);
  const extra = roster.length - shown.length;
  const leadOnStage = active.key === "lead";
  return (
    <>
      <div
        className="absolute flex items-center justify-between px-3"
        style={{
          left: card.x,
          top: card.y + 4,
          width: card.width,
          height: TEAM_HEADER,
        }}
      >
        <button
          type="button"
          onClick={() => onPickBot("lead")}
          className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11.5px] text-white/75 transition-colors hover:bg-white/[0.14] hover:text-white"
        >
          <PencilIcon className="size-3" />
          {t("askName", { name: leadName })}
        </button>
        <button
          type="button"
          onClick={onAddBot}
          title={t("newBotHint")}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <PlusIcon className="size-3" />
          {t("newBot")}
        </button>
      </div>
      <motion.button
        type="button"
        onClick={() => onPickBot("lead")}
        className="absolute flex items-center gap-2.5 rounded-full border pr-3 pl-1.5 text-left"
        style={{
          ...boxStyle(slots.lead),
          background: `${colorOf(lead)}1c`,
          borderColor: `${colorOf(lead)}${leadOnStage ? "99" : "55"}`,
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
        {/* The lead itself, always: resting while it's also the big bot, alive while it stands by. */}
        <ChipFace
          bot={lead}
          size={28}
          cowork
          paused={leadOnStage}
          mood={
            leadOnStage && snapshot.phase === "working" ? "working" : "idle"
          }
          pulse={leadOnStage ? "stage" : "chip"}
        />
        <span
          className="truncate text-[13px] font-semibold"
          style={{ color: colorOf(lead) }}
        >
          {leadName}
        </span>
        <span className="ml-auto shrink-0 text-[10.5px] text-white/40">
          {leadOnStage
            ? snapshot.phase === "working"
              ? t("onIt")
              : t("lead")
            : t("standingBy")}
        </span>
      </motion.button>
      {roster.length === 0 ? (
        <motion.div
          className="absolute flex items-center gap-3 rounded-2xl border border-dashed border-white/15 px-3"
          style={boxStyle(slots.group)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-white/80">
              {t("noBots")}
            </span>
            <span className="block truncate text-[10.5px] text-white/40">
              {t("noBotsBody")}
            </span>
          </span>
          <button
            type="button"
            onClick={onAddBot}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-[12px] font-semibold text-black transition-transform active:scale-95"
          >
            <PlusIcon className="size-3.5" />
            {t("newBot")}
          </button>
        </motion.div>
      ) : (
        <motion.button
          type="button"
          onClick={() => onTeamOpen?.(!teamOpen)}
          className={cn(
            "absolute flex items-center gap-3 rounded-2xl border px-2.5 text-left transition-colors",
            teamOpen
              ? "border-white/25 bg-white/[0.06]"
              : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]",
          )}
          style={boxStyle(slots.group)}
          whileTap={{ scale: 0.98 }}
        >
          <span className="flex shrink-0 items-center">
            {shown.slice(0, 5).map((mate, i) => (
              <BotPicture
                key={mate.id}
                bot={mate.mascot}
                size={28}
                mood={moodOf(snapshot.team.find((m) => m.id === mate.id))}
                style={{
                  marginLeft: i ? -10 : 0,
                  opacity: teamOpen ? 0.45 : 1,
                  transition: "opacity 0.2s",
                }}
              />
            ))}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-white/90">
              {t("team")} ·{" "}
              <span className="tabular-nums">{roster.length}</span>
            </span>
            <span
              className="truncate text-[11px]"
              style={{ color: working.length ? BLUE : undefined }}
            >
              {working.length ? (
                t("teamBusy", {
                  n: working.length,
                  free: Math.max(0, roster.length - working.length),
                })
              ) : (
                <span className="text-white/40">{t("teamFree")}</span>
              )}
            </span>
          </span>
          {extra > 0 && (
            <span className="shrink-0 text-[11px] text-white/35">+{extra}</span>
          )}
          <ChevronDownIcon
            className={cn(
              "ml-auto size-4 shrink-0 text-white/50 transition-transform",
              teamOpen ? "rotate-180" : "-rotate-90",
            )}
          />
        </motion.button>
      )}
      <AnimatePresence initial={false}>
        {slots.chips.map((chip, i) => {
          const mate = shown[i];
          const run = snapshot.team.find((m) => m.id === mate.id);
          const stepped = mate.id === active.key;
          return (
            <motion.button
              type="button"
              key={mate.id}
              title={`${mate.name} — ${mate.role || t("askDirectly")}`}
              onClick={() => onPickBot(mate.id)}
              className="absolute flex items-center gap-2 rounded-full border pr-3 pl-1 text-left"
              style={{
                ...boxStyle(chip),
                background: `${mate.color}1c`,
                borderColor: stepped ? `${mate.color}cc` : `${mate.color}4d`,
              }}
              initial={{ opacity: 0, y: -6, scale: 0.94 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { delay: 0.04 + i * 0.035 },
              }}
              exit={{
                opacity: 0,
                y: -6,
                scale: 0.94,
                transition: { duration: 0.12 },
              }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              <ChipFace
                bot={mate.mascot}
                size={26}
                away={stepped}
                mood={moodOf(run)}
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span
                  className="truncate text-[12.5px] font-semibold"
                  style={{ color: mate.color }}
                >
                  {mate.name}
                </span>
                {run && !run.done && (
                  <span className="truncate text-[10px] text-white/55">
                    {run.status}
                  </span>
                )}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </>
  );
}

function Todos({ todos }: { todos: TodoItem[] }) {
  const t = useNotchText();
  const done = todos.filter(isDone).length;
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-white/40 uppercase">
        {t("plan")} · {done}/{todos.length}
      </p>
      {todos.slice(0, 4).map((todo, i) => {
        const finished = isDone(todo);
        const active = isActive(todo);
        return (
          <div
            key={todo.id ?? i}
            className="flex min-w-0 items-center gap-2 text-[13px]"
          >
            {finished ? (
              <CheckIcon
                className="size-3.5 shrink-0"
                style={{ color: GREEN }}
              />
            ) : active ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-white/70" />
            ) : (
              <CircleIcon className="size-3.5 shrink-0 text-white/25" />
            )}
            <span
              className={cn(
                "truncate",
                finished
                  ? "text-white/35 line-through"
                  : active
                    ? "text-white"
                    : "text-white/60",
              )}
            >
              {todo.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── sessions ──

const MODE_TINT: Record<NotchSession["mode"], string> = {
  cowork: GREEN,
  chat: BLUE,
  code: "#ff9a2e",
};

/** "<1m", "5m", "2h", "3d": how long ago, as the list's last column. */
function ago(at: number, now: number) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Chats to pick up again: the ones running first, then the latest. Each
 * row says where and what, the user's last words, what it's doing now,
 * and its mode, model and age; tap one to carry on with it right here.
 */
function Sessions({ geometry, sessions, onPickSession, onOpenChat }: Props) {
  const t = useNotchText();
  const top = topRowOf(geometry);
  // Ages are read when the list opens or changes; nothing ticks while it's up.
  const now = Date.now();
  return (
    <div className="absolute inset-x-3 bottom-3 flex flex-col" style={{ top }}>
      {/* The bot sits at the header's start (`mascotFrame`). */}
      <div
        className="flex shrink-0 items-center gap-2 pr-2 pl-9"
        style={{ height: SESSION_HEADER }}
      >
        <span className="text-[11px] font-medium tracking-wide text-white/40 uppercase">
          {t("sessions")}
        </span>
        {sessions && sessions.length > 0 && (
          <span className="text-[11px] text-white/25 tabular-nums">
            {sessions.length}
          </span>
        )}
        <span className="ml-auto text-[11px] text-white/30">
          {t("sessionsHint")}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!sessions ? (
          <div className="flex h-full items-center justify-center text-white/40">
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-[13px] font-medium text-white/70">
              {t("noSessions")}
            </p>
            <p className="text-[11px] text-white/40">{t("noSessionsBody")}</p>
          </div>
        ) : (
          sessions.map((session, i) => (
            <SessionRow
              key={session.id}
              session={session}
              index={i}
              now={now}
              onPick={() => onPickSession?.(session)}
              onOpen={() => onOpenChat()}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** A small mark per mode, drawn in CSS: a few pixels, like a sprite. */
function ModeMark({
  mode,
  running,
}: {
  mode: NotchSession["mode"];
  running: boolean;
}) {
  const color = MODE_TINT[mode];
  // A 3×3 sprite: the cells that are lit, per mode.
  const cells =
    mode === "cowork"
      ? [0, 2, 3, 4, 5, 7]
      : mode === "code"
        ? [1, 3, 5, 7, 4]
        : [0, 1, 2, 3, 5, 7];
  return (
    <span
      className="grid shrink-0 grid-cols-3 gap-[2px]"
      style={{ width: 22, height: 22 }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-[1.5px]",
            running && cells.includes(i) && "notch-loop",
          )}
          style={{
            background: cells.includes(i) ? color : "transparent",
            animation:
              running && cells.includes(i)
                ? `notch-dim 1.2s ease-in-out ${(i % 3) * 0.15}s infinite`
                : undefined,
          }}
        />
      ))}
    </span>
  );
}

function SessionRow({
  session,
  index,
  now,
  onPick,
}: {
  session: NotchSession;
  index: number;
  now: number;
  onPick: () => void;
  onOpen: () => void;
}) {
  const t = useNotchText();
  const where =
    session.folder ?? t(session.mode === "chat" ? "chat" : "cowork");
  return (
    <motion.button
      type="button"
      onClick={onPick}
      className="flex w-full items-start gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
      style={{ minHeight: SESSION_ROW - 4 }}
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { delay: Math.min(index, 6) * 0.03 },
      }}
    >
      <span className="mt-1">
        <ModeMark mode={session.mode} running={session.running} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-white/90">
            {where} <span className="text-white/35">·</span>{" "}
            {session.title || t("untitled")}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <Tag color={MODE_TINT[session.mode]}>
              {t(
                session.mode === "code"
                  ? "code"
                  : session.mode === "chat"
                    ? "chat"
                    : "cowork",
              )}
            </Tag>
            {session.model && <Tag>{session.model}</Tag>}
            {session.waiting ? (
              <span
                className="notch-loop flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-black"
                style={{
                  background: AMBER,
                  animation: "notch-beat 1.2s ease-in-out infinite",
                }}
              >
                !
              </span>
            ) : session.running ? (
              <span
                className="notch-loop size-2 rounded-full"
                style={{
                  background: GREEN,
                  animation: "notch-fade 1.4s ease-in-out infinite",
                }}
              />
            ) : (
              <span className="w-7 text-right text-[11px] text-white/35 tabular-nums">
                {ago(session.updatedAt, now)}
              </span>
            )}
          </span>
        </span>
        {session.asked && (
          <span className="truncate text-[12px] text-white/50">
            {t("you")}: {session.asked}
          </span>
        )}
        {session.step ? (
          <span className="truncate text-[12px]">
            <span className="font-medium" style={{ color: BLUE }}>
              {session.step.kind}
            </span>{" "}
            <span className="text-white/45">
              {session.step.title.slice(session.step.kind.length).trim()}
            </span>
          </span>
        ) : session.failed ? (
          <span className="truncate text-[12px]" style={{ color: RED }}>
            {t("failedShort")}
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}

function Tag({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <span
      className="max-w-28 truncate rounded-md px-1.5 py-px text-[10.5px] font-medium"
      style={
        color
          ? { background: `${color}26`, color }
          : {
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.6)",
            }
      }
    >
      {children}
    </span>
  );
}

// ── peek ──

const PEEK_TINT: Record<
  NotchPeek["tone"],
  { from: string; to: string; ink: string }
> = {
  done: { from: "#1f9d5c", to: "#0b2a1b", ink: "#6ee7a8" },
  failed: { from: "#c2412d", to: "#2c0f0b", ink: "#ff9b85" },
  team: { from: "#2f6fd6", to: "#0d1a33", ink: "#8cc2ff" },
  edit: { from: "#6d4ad9", to: "#160f2e", ink: "#c4b5fd" },
};

/**
 * News, told for a moment: a card in the news' color — the bot it's about
 * on the left, what happened and a line more — then the pill folds back.
 * A file edit shows its first changed lines. With a team at work, its
 * faces stand in a capsule on the right.
 */
function Peek({
  geometry,
  peek,
  snapshot,
  onPeekClose,
}: Props & { peek: NotchPeek }) {
  const t = useNotchText();
  const top = topRowOf(geometry);
  const tint = PEEK_TINT[peek.tone];
  const mates = snapshot.team.slice(-4);
  const side = mates.length > 0 ? 52 : 0;
  return (
    <>
      <motion.div
        className="absolute overflow-hidden rounded-[22px]"
        style={{
          ...DARK_VARS,
          left: PAD,
          right: PAD + side,
          top,
          bottom: PAD,
          background: `radial-gradient(130% 160% at 50% 120%, ${tint.from} 0%, ${tint.from}aa 22%, ${tint.to} 70%)`,
        }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="absolute inset-y-0 right-12 left-[96px] flex flex-col justify-center gap-1">
          <p className="truncate text-[16px] font-semibold text-white">
            {peek.title}
          </p>
          {peek.edit ? (
            <EditLines edit={peek.edit} ink={tint.ink} />
          ) : (
            peek.detail && (
              <p className="truncate text-[13px]" style={{ color: tint.ink }}>
                {peek.detail}
              </p>
            )
          )}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPeekClose?.();
          }}
          title={t("close")}
          className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white/70 transition-colors hover:bg-black/40 hover:text-white"
        >
          <XIcon className="size-3.5" />
        </button>
      </motion.div>
      {side > 0 && (
        <motion.div
          className="absolute flex flex-col items-center justify-center rounded-full bg-white/[0.06]"
          style={{ right: PAD, top, bottom: PAD, width: side - 8 }}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0, transition: { delay: 0.08 } }}
        >
          {mates.map((mate, i) => (
            <BotPicture
              key={mate.id}
              bot={mate.mascot}
              size={26}
              mood={moodOf(mate)}
              style={{ marginTop: i ? -8 : 0 }}
            />
          ))}
        </motion.div>
      )}
    </>
  );
}

/** A file's diff, a taste of it: its name and size, then its first changed lines. */
export function EditLines({
  edit,
  ink,
  lines = 3,
}: {
  edit: NotchEdit;
  ink?: string;
  lines?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" style={DARK_VARS}>
      <p className="flex min-w-0 items-center gap-2 text-[12px]">
        <span className="min-w-0 truncate font-mono" style={{ color: ink }}>
          {edit.path}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          {edit.additions > 0 && (
            <span className="text-emerald-300">+{edit.additions}</span>
          )}
          {edit.deletions > 0 && (
            <span className="ml-1 text-rose-300">−{edit.deletions}</span>
          )}
        </span>
      </p>
      {edit.lines.length > 0 && (
        <div className="overflow-hidden rounded-lg bg-[#0b0b10]/70 py-1 font-mono text-[11px] leading-[1.45]">
          {edit.lines.slice(0, lines).map((line, i) => (
            <div
              key={i}
              className={cn(
                "truncate px-2 whitespace-pre",
                line.tag === "add" && "bg-emerald-400/15 text-emerald-100",
                line.tag === "del" &&
                  "bg-rose-400/15 text-rose-100/80 line-through decoration-rose-300/40",
                line.tag === "ctx" && "text-white/40",
              )}
            >
              <span className="mr-1.5 inline-block w-2 opacity-60 select-none">
                {line.tag === "add" ? "+" : line.tag === "del" ? "−" : " "}
              </span>
              {line.text || " "}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── welcome ──

/** The first open after going into notch mode: the bot wakes up, then waits for work. */
/**
 * A run finished with something to see: the pill opens on it by itself —
 * the bot pleased with itself, and the first thing it made, page by page.
 */
function Done({ snapshot, geometry }: Props) {
  const t = useNotchText();
  const top = topRowOf(geometry);
  const [first, ...rest] = snapshot.showcase ?? [];
  const more = rest.reduce((n, s) => n + s.items.length, 0);
  return (
    <>
      <div
        className="absolute rounded-[22px] bg-white/[0.05]"
        style={{ left: PAD, right: PAD, top, bottom: PAD }}
      />
      <div
        className="absolute flex min-w-0 flex-col gap-2.5"
        style={{
          left: PAD + 14 + 72 + 16,
          right: PAD + 14,
          top: top + 12,
          bottom: PAD + 10,
        }}
      >
        <motion.div
          className="flex min-w-0 items-center gap-2 text-[13px]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
        >
          <span
            className="flex size-[18px] shrink-0 items-center justify-center rounded-full"
            style={{ background: GREEN }}
          >
            <CheckIcon className="size-3 text-black" strokeWidth={3} />
          </span>
          <span className="shrink-0 font-semibold">{t("madeIt")}</span>
          {snapshot.title && (
            <span className="min-w-0 truncate text-white/45">
              · {snapshot.title}
            </span>
          )}
          {more > 0 && (
            <span className="ml-auto shrink-0 text-[11px] text-white/40">
              {t("more", { n: more })}
            </span>
          )}
        </motion.div>
        {first && <Showcase showcase={first} height={100} />}
      </div>
    </>
  );
}

function Welcome({ geometry, shape, welcomeState, active }: Props) {
  const t = useNotchText();
  const top = topRowOf(geometry);
  const ready = welcomeState !== "thinking";
  return (
    <>
      <div
        className="absolute rounded-[22px] bg-white/[0.05]"
        style={{ left: PAD, right: PAD, top, bottom: PAD }}
      />
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: shape.height - PAD - 30 }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={ready ? "ready" : "waking"}
            className="text-[12px] text-white/50"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          >
            {ready ? t("ready", { name: active.name }) : t("waking")}
          </motion.p>
        </AnimatePresence>
      </div>
    </>
  );
}

// ── drop ──

/** Files over the pill: a green glow rising from the bottom. */
function DropGlow({ geometry }: { geometry: NotchGeometry }) {
  const top = topRowOf(geometry);
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0"
      style={{
        top,
        background:
          "radial-gradient(60% 90% at 50% 100%, rgba(52,199,123,0.42), rgba(52,199,123,0.08) 55%, transparent 80%)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    />
  );
}

/** Drop here: a dashed frame, what it takes, and the bot waiting to catch it. */
function Drop({ geometry, drop }: Props) {
  const t = useNotchText();
  const top = topRowOf(geometry);
  const taken = drop === "taken";
  return (
    <>
      <motion.div
        className="absolute inset-x-0 border-y-2 border-dashed border-emerald-300/40"
        style={{ top: top + 2, bottom: PAD }}
        initial={{ scaleX: 0.6, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      />
      <div
        className="absolute inset-x-0 flex flex-col items-center gap-2"
        style={{ top: top + 84 }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={taken ? "taken" : "over"}
            className="text-[15px] font-medium text-white/80"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          >
            {taken ? t("gotIt") : t("dropFiles")}
          </motion.p>
        </AnimatePresence>
        <div className="flex gap-1.5">
          {t("kinds")
            .split(",")
            .map((kind, i) => (
              <motion.span
                key={kind}
                className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[11px] text-white/55"
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: 0.12 + i * 0.05 },
                }}
              >
                {kind}
              </motion.span>
            ))}
        </div>
      </div>
    </>
  );
}

// ── permission ──

/** A light from the bot's side: amber for an approval, blue for a question. */
function PermissionGlow({ color = AMBER }: { color?: string }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background: `radial-gradient(120% 140% at 8% 70%, ${color}55 0%, ${color}1f 32%, transparent 62%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    />
  );
}

/** The approval's own top row: the chat's title, and the app. */
function PermissionTop({ snapshot, geometry, shape, onOpenChat }: Props) {
  const t = useNotchText();
  const top = topRowOf(geometry);
  const side = sideOf(geometry, shape);
  return (
    <div
      className="absolute inset-x-0 top-0 flex items-center justify-between px-5"
      style={{ height: top }}
    >
      <p
        className="truncate text-[12px] font-medium text-white/55"
        style={{ maxWidth: side }}
      >
        {snapshot.title}
      </p>
      <button
        type="button"
        onClick={onOpenChat}
        className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[12px] text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white"
      >
        {t("open")}
        <ArrowUpRightIcon className="size-3" />
      </button>
    </div>
  );
}

function Permission(props: Props) {
  const { snapshot, geometry, active, answering, onReply } = props;
  const t = useNotchText();
  const top = topRowOf(geometry);
  const more = snapshot.waiting - 1;
  return (
    <>
      <PermissionTop {...props} />
      <div
        className="absolute right-6 bottom-5 left-[124px] flex flex-col justify-center gap-2.5"
        style={{ top }}
      >
        <div className="flex min-w-0 items-center gap-2 text-[15px]">
          <span
            className="notch-loop size-2 shrink-0 rounded-full bg-white"
            style={{ animation: "notch-fade 1.4s ease-in-out infinite" }}
          />
          <span className="truncate font-semibold">
            {snapshot.asker?.name ?? active.name}
          </span>
          <span className="shrink-0 text-white/50">{t("needsPermission")}</span>
          {more > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-white/[0.1] px-2 py-0.5 text-[11px] text-white/70">
              {t("waiting", { n: more })}
            </span>
          )}
        </div>
        <div
          title={snapshot.command}
          className="truncate rounded-xl bg-white/[0.08] px-4 py-2.5 font-mono text-[13px] text-white/90"
        >
          {snapshot.command}
        </div>
        <div className="flex items-center gap-2.5">
          <ReplyButton
            label={t("deny")}
            hotkey="N"
            busy={answering === "reject"}
            disabled={!!answering}
            onClick={() => onReply("reject")}
            className="bg-white/[0.09] text-white hover:bg-white/[0.16]"
            keyClass="border-white/25 text-white/70"
          />
          <ReplyButton
            label={t("allow")}
            hotkey="Y"
            busy={answering === "once"}
            disabled={!!answering}
            onClick={() => onReply("once")}
            className="bg-white text-black hover:bg-white/90"
            keyClass="border-black/20 text-black/60"
          />
        </div>
      </div>
    </>
  );
}

/** The agent's question: the bot on the left, the card beside it; the chat's title and the app above. */
function QuestionView(props: Props) {
  const { snapshot, geometry, active, onAnswer, questionBusy } = props;
  const top = topRowOf(geometry);
  if (!snapshot.question) return null;
  return (
    <>
      <PermissionTop {...props} />
      <div
        className="absolute right-3 bottom-3 flex"
        style={{ top, left: QUESTION_LEFT }}
      >
        <NotchQuestion
          request={snapshot.question}
          asker={snapshot.asker?.name ?? active.name}
          busy={!!questionBusy}
          onAnswer={(answers) => onAnswer?.(answers)}
          keys
          className="flex-1"
        />
      </div>
    </>
  );
}

function ReplyButton({
  label,
  hotkey,
  busy,
  disabled,
  onClick,
  className,
  keyClass,
}: {
  label: string;
  hotkey: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  className: string;
  keyClass: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "flex h-9 items-center gap-2 rounded-full pr-2 pl-4 text-[14px] font-semibold transition-colors disabled:opacity-60",
        className,
      )}
    >
      {label}
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-md border text-[11px] font-medium",
          keyClass,
        )}
      >
        {busy ? <Loader2Icon className="size-3 animate-spin" /> : hotkey}
      </span>
    </motion.button>
  );
}
