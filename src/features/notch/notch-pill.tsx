/**
 * The pill: a black shape that grows out of the notch. It's always dark (it
 * has to read as part of the notch), so it uses fixed colors rather than the
 * app's theme.
 *
 * The bots stay mounted and glide between their spots, so their animations
 * never restart: the main bot (Mali, or the team bot that's working or being
 * asked) takes the big spot, and when a team bot steps in, Mali takes its
 * chip until it's done. The shape springs between sizes and the content
 * inside fades through a blur.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import { BOTS, type BotState, type CoworkBotId } from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/pages/chat/api/chat";
import {
  ArrowUpRightIcon,
  CameraIcon,
  CheckIcon,
  CircleIcon,
  FileTextIcon,
  GlobeIcon,
  HammerIcon,
  HistoryIcon,
  HomeIcon,
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig, type Transition } from "motion/react";
import { useRef, type ReactNode } from "react";
import {
  EAR,
  homeCards,
  mascotFrame,
  PAD,
  radiusOf,
  shapeSize,
  sideOf,
  TEAM_HEADER,
  teamSlots,
  topRowOf,
  WING,
  type Frame,
  type Size,
} from "./layout";
import { setNotchSaveChats, useNotchSaveChats } from "./settings";
import { Showcase, ShowcaseViewerHost } from "./notch-showcase";
import { useNotchText, type NotchText } from "./text";
import type { RosterBot } from "./team";
import type { NotchGeometry, NotchMate, NotchSnapshot, NotchStep, NotchView } from "./types";

/** Dynamic Island–like: quick, with a little overshoot. */
const SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 };
const AMBER = "#f5a524";
const GREEN = "#34c77b";

/** Who is in the main spot: Mali ("lead") or a team bot by its id. */
export type ActiveBot = { key: string; bot: CoworkBotId; name: string };

type Props = {
  snapshot: NotchSnapshot;
  view: NotchView;
  geometry: NotchGeometry;
  shape: Size;
  /** The user's own bot: Mali, the lead. */
  lead: CoworkBotId;
  active: ActiveBot;
  /** The bots on the user's team. */
  roster: RosterBot[];
  /** An answer was sent and the main window hasn't confirmed it yet. */
  answering: "once" | "reject" | undefined;
  onReply: (reply: "once" | "reject") => void;
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
};

export function NotchPill(props: Props) {
  const { view, geometry, shape, snapshot } = props;
  const radius = radiusOf(view, geometry);
  const open = view !== "collapsed";
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
          <Ear side="left" />
          <Ear side="right" />
          <motion.div
            className="absolute inset-0 overflow-hidden bg-black text-white"
            initial={false}
            animate={{
              borderBottomLeftRadius: radius,
              borderBottomRightRadius: radius,
              boxShadow: open ? "0 18px 40px -14px rgba(0,0,0,0.7)" : "0 0 0 0 rgba(0,0,0,0)",
            }}
            onClick={view === "collapsed" ? props.onPress : undefined}
          >
            <ShowcaseViewerHost resetKey={view}>
              <AnimatePresence initial={false}>
                {view === "permission" && <PermissionGlow key="glow" />}
                {view === "drop" && <DropGlow key="drop-glow" geometry={geometry} />}
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
                {view === "permission" && snapshot.permission && (
                  <Fade key="permission">
                    <Permission {...props} />
                  </Fade>
                )}
              </AnimatePresence>
              {/* Above the content, so the bots sit on their cards and chips. */}
              <Mascots {...props} />
              {(view === "home" || view === "chat" || view === "welcome" || view === "drop" || view === "done") && (
                <TopBar {...props} />
              )}
            </ShowcaseViewerHost>
          </motion.div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

/** The concave curve joining the pill to the top edge, like the notch's own. */
function Ear({ side }: { side: "left" | "right" }) {
  const at = side === "left" ? "0% 100%" : "100% 100%";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0"
      style={{
        width: EAR,
        height: EAR,
        [side]: -EAR,
        background: `radial-gradient(circle at ${at}, transparent ${EAR - 0.5}px, #000 ${EAR}px)`,
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
      animate={{ opacity: 1, filter: "blur(0px)", scale: 1, transition: { delay: 0.08, duration: 0.28 } }}
      exit={{ opacity: 0, filter: "blur(6px)", scale: 0.98, transition: { duration: 0.14 } }}
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
  onHome,
  onChat,
  onNewChat,
  onOpenChat,
  onCapturePick,
  capturing,
}: Props) {
  const top = topRowOf(geometry);
  const side = sideOf(geometry, shape);
  const save = useNotchSaveChats();
  const t = useNotchText();
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3.5" style={{ height: top }}>
      <div className="flex items-center gap-1" style={{ maxWidth: side }}>
        <Tab title={t("home")} on={view === "home" || view === "welcome"} onClick={onHome}>
          <HomeIcon className="size-3.5" />
        </Tab>
        <Tab title={t("ask")} on={view === "chat"} onClick={onChat}>
          <MessageCircleIcon className="size-3.5" />
        </Tab>
        <Tab title={t("newQuestion")} onClick={onNewChat}>
          <PlusIcon className="size-3.5" />
        </Tab>
        <Tab title={t("capture")} onClick={onCapturePick}>
          {capturing ? <Loader2Icon className="size-3.5 animate-spin" /> : <CameraIcon className="size-3.5" />}
        </Tab>
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[11px]" style={{ maxWidth: side }}>
        {view === "home" && snapshot.running > 1 && (
          <span className="text-white/50">{t("running", { n: snapshot.running })}</span>
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
      {on && <motion.span layoutId="notch-tab" className="absolute inset-0 rounded-full bg-white/[0.12]" />}
      <span className="relative">{children}</span>
    </button>
  );
}

// ── bots ──

/** A bot and where it goes. Hidden bots stay mounted (an iframe that unmounts reloads, which flickers). */
type Spot = { key: string; bot: CoworkBotId; frame: Frame; state: BotState; main: boolean; visible: boolean };

function mainState({ snapshot, view, chatBusy, welcomeState, drop, active }: Props): BotState {
  if (view === "permission") return "permission";
  if (view === "done") return "done";
  if (view === "welcome") return welcomeState ?? "idle";
  if (view === "drop") return drop === "taken" ? "done" : "welcome";
  if (view === "chat") return chatBusy ? "thinking" : "idle";
  if (snapshot.phase === "idle") return chatBusy ? "thinking" : "idle";
  if (snapshot.phase === "done" && active.key === "lead") return "done";
  return view === "collapsed" ? "working" : "tool";
}

function mateState(mate: RosterBot, snapshot: NotchSnapshot): BotState {
  const run = snapshot.team.find((m) => m.id === mate.id);
  if (!run) return "idle";
  return run.done ? "done" : "working";
}

/**
 * Every bot and where it goes: the main spot, a chip, or Mali in the chip of
 * the bot that stepped up. Outside Home the team waits, hidden, where its
 * chips will be, so opening Home only fades them in.
 */
function spotsOf(props: Props): Spot[] {
  const { view, geometry, shape, lead, active, roster, snapshot } = props;
  const main = mascotFrame(view, geometry, shape);
  const spots: Spot[] = [
    { key: active.key, bot: active.bot, frame: main, state: mainState(props), main: true, visible: true },
  ];
  const home = view === "home";
  // Where Home's chips are, in this shape's coordinates (both are centered).
  const homeShape = home ? shape : shapeSize("home", geometry);
  const shift = (shape.width - homeShape.width) / 2;
  const slots = teamSlots(homeCards(geometry, homeShape, true).right!, roster.length).bots.map((slot) => ({
    ...slot.bot,
    x: slot.bot.x + shift,
  }));
  let leadPlaced = active.key === "lead";
  roster.slice(0, slots.length).forEach((mate, i) => {
    if (mate.id === active.key) {
      // The bot stepped up to the main spot; Mali waits in its chip.
      spots.push({ key: "lead", bot: lead, frame: slots[i], state: "idle", main: false, visible: home });
      leadPlaced = true;
    } else {
      const state = home ? mateState(mate, snapshot) : "idle";
      spots.push({ key: mate.id, bot: mate.mascot, frame: slots[i], state, main: false, visible: home });
    }
  });
  if (!leadPlaced) spots.push({ key: "lead", bot: lead, frame: main, state: "idle", main: false, visible: false });
  return spots;
}

function colorOf(bot: CoworkBotId) {
  return BOTS.find((b) => b.id === bot)?.color ?? "#3aa3f5";
}

function Mascots(props: Props) {
  const spots = spotsOf(props);
  return (
    <AnimatePresence initial={false}>
      {spots.map((spot) => (
        <motion.div
          key={spot.key}
          className={cn("absolute top-0 left-0 z-10", spot.main ? "cursor-pointer" : "pointer-events-none")}
          initial={{
            opacity: 0,
            scale: 0.6,
            x: spot.frame.x,
            y: spot.frame.y,
            width: spot.frame.size,
            height: spot.frame.size,
          }}
          animate={{
            opacity: spot.visible ? 1 : 0,
            scale: spot.visible ? 1 : 0.6,
            x: spot.frame.x,
            y: spot.frame.y,
            width: spot.frame.size,
            height: spot.frame.size,
            transition: spot.visible ? SPRING : { ...SPRING, opacity: { duration: 0.12 } },
          }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18 } }}
          onDoubleClick={
            spot.main
              ? (event) => {
                  event.stopPropagation();
                  props.onDismiss();
                }
              : undefined
          }
          title={spot.main ? "Double-click to hide" : undefined}
        >
          {spot.main && <Glow {...props} bot={spot.bot} />}
          <CoworkBot
            size="100%"
            bot={spot.bot}
            state={spot.state}
            theme="dark"
            className="relative"
            // Hidden bots stay mounted (no reload flicker) but rest.
            paused={!spot.visible}
          />
          {spot.main && <Badges {...props} />}
          {spot.main && props.view !== "permission" && <BotHandle {...props} bot={spot.bot} />}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

/**
 * Drag the bot out of the notch and let go on any window: Mali captures that
 * window for the ask box. The system drag image (a little bot) follows the
 * cursor across the whole screen, outside the notch's own window.
 */
function BotHandle({ bot, onBotDropped }: Props & { bot: CoworkBotId }) {
  const t = useNotchText();
  const image = useRef<HTMLCanvasElement | null>(null);
  // Ready before the drag starts: the drag image must be set synchronously.
  const prepare = (handle: HTMLElement) => {
    const frame = handle.parentElement?.querySelector<HTMLIFrameElement>("iframe[data-cowork-bot]");
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
async function botImage(frame: HTMLIFrameElement | null | undefined, color: string) {
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
  markup = markup.replace("<svg", `<svg width="${DRAG_SIZE * 2}" height="${DRAG_SIZE * 2}"`);
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

/** A soft light behind the main bot; it breathes while there's work. */
function Glow({ snapshot, view, bot, drop }: Props & { bot: CoworkBotId }) {
  const big = view !== "collapsed" && view !== "chat";
  const color = view === "permission" ? AMBER : view === "drop" || snapshot.phase === "done" ? GREEN : colorOf(bot);
  const breathing = big && (snapshot.phase === "working" || view === "welcome" || (view === "drop" && drop === "over"));
  return (
    <motion.div
      aria-hidden
      className="absolute -inset-[45%]"
      initial={false}
      animate={big ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
      transition={{ duration: 0.3 }}
    >
      <div
        className={cn("size-full rounded-full blur-2xl", breathing && "notch-loop")}
        style={{
          background: color,
          opacity: 0.4,
          animation: breathing ? "notch-breathe 2.4s ease-in-out infinite" : undefined,
        }}
      />
    </motion.div>
  );
}

function Badges({ snapshot, view }: Props) {
  const big = view === "home" || view === "permission";
  return (
    <AnimatePresence>
      {big && snapshot.phase === "permission" && (
        <Badge key="alert" color={AMBER}>
          <span className="text-[13px] leading-none font-bold text-black">!</span>
        </Badge>
      )}
      {big && snapshot.phase === "working" && (
        <Badge key="busy" color="#3aa3f5">
          <Dots />
        </Badge>
      )}
    </AnimatePresence>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <motion.div
      className="absolute -top-1 -left-1 flex size-6 items-center justify-center rounded-full ring-2 ring-black"
      style={{ background: color }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, transition: { delay: 0.18, type: "spring", stiffness: 520, damping: 18 } }}
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
          style={{ animation: `notch-dim 1s ease-in-out ${i * 0.18}s infinite` }}
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
  return snapshot.steps[currentStepIndex(snapshot.steps)]?.title ?? t("working");
}

/** The bot on the left wing, a status on the right; the step in between without a notch. */
function Collapsed({ snapshot, geometry, chatBusy }: Props) {
  const t = useNotchText();
  const text = stepText(snapshot, t);
  return (
    <div className="flex h-full cursor-pointer items-center">
      <div style={{ width: WING }} className="shrink-0" />
      <div className="min-w-0 flex-1 px-1">
        {!geometry.hasNotch && (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={text}
              className="truncate text-center text-[12px] font-medium text-white/80"
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            >
              {text}
            </motion.p>
          </AnimatePresence>
        )}
      </div>
      <div style={{ width: WING }} className="flex shrink-0 items-center justify-center pr-1">
        <Indicator snapshot={snapshot} chatBusy={chatBusy} />
      </div>
    </div>
  );
}

function indicatorOf(snapshot: NotchSnapshot, chatBusy?: boolean) {
  if (snapshot.phase === "idle") return chatBusy ? "busy" : "idle";
  if (snapshot.phase === "done") return "done";
  if (snapshot.phase === "permission") return "ask";
  if (snapshot.team.some((m) => !m.done)) return "team";
  if (snapshot.todos.length) return "todos";
  return "busy";
}

function Indicator({ snapshot, chatBusy }: { snapshot: NotchSnapshot; chatBusy?: boolean }) {
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
          <span className="flex size-[18px] items-center justify-center rounded-full" style={{ background: GREEN }}>
            <CheckIcon className="size-3 text-black" strokeWidth={3} />
          </span>
        )}
        {kind === "ask" && (
          <span
            className="notch-loop flex size-[18px] items-center justify-center rounded-full text-[11px] font-bold text-black"
            style={{ background: AMBER, animation: "notch-beat 1.2s ease-in-out infinite" }}
          >
            !
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
            animation: mate.done ? undefined : `notch-shrink 1.1s ease-in-out ${i * 0.15}s infinite`,
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
  return !isDone(todo) && (todo.status === "in_progress" || todo.status === "inProgress");
}

/** How far through its plan the agent is. */
function Ring({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter(isDone).length;
  const r = 7;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" />
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
        animate={{ strokeDashoffset: length * (1 - done / Math.max(todos.length, 1)) }}
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
          style={{ animation: `notch-bar 0.9s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}

// ── home ──

function Home(props: Props) {
  const { snapshot, geometry, shape, roster } = props;
  // The right card is the team (a CTA to make one when there's none), or the
  // plan while a run without a team has one.
  const side = roster.length === 0 && snapshot.todos.length > 0 ? "todos" : "team";
  const cards = homeCards(geometry, shape, true);
  const left = cards.left;
  const right = cards.right!;
  return (
    <>
      <div
        className="absolute rounded-[22px] bg-white/[0.06]"
        style={{ left: left.x, top: left.y, width: left.width, height: left.height }}
      >
        {snapshot.phase === "idle" ? <Greeting {...props} /> : <RunLines {...props} />}
      </div>
      <div
        className="absolute rounded-[22px] bg-white/[0.06]"
        style={{ left: right.x, top: right.y, width: right.width, height: right.height }}
      >
        {side === "todos" && <Todos todos={snapshot.todos} />}
      </div>
      {side === "team" && <TeamCard {...props} />}
    </>
  );
}

/** Nothing running: who's here and how to ask. */
function Greeting({ active, onChat }: Props) {
  const t = useNotchText();
  return (
    <div className="absolute inset-y-0 right-4 left-[120px] flex flex-col justify-center gap-1.5">
      <p className="truncate text-[15px] font-semibold text-white">{t("greeting", { name: active.name })}</p>
      <p className="text-[12px] leading-snug text-white/50">{t("greetingBody")}</p>
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
          <kbd className="rounded border border-white/15 px-1 font-sans">⌥⌘M</kbd> {t("anywhere")}
        </span>
      </div>
    </div>
  );
}

/** The run: who's on it, how far through the plan, and the steps rolling by. */
function RunLines(props: Props) {
  const { snapshot, active, onOpenChat } = props;
  const t = useNotchText();
  const done = snapshot.todos.filter(isDone).length;
  return (
    <div className="absolute inset-y-0 right-3 left-[120px] flex flex-col justify-center gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full bg-white", snapshot.phase === "working" && "notch-loop")}
          style={{ animation: snapshot.phase === "working" ? "notch-fade 1.4s ease-in-out infinite" : undefined }}
        />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={active.key}
            className="shrink-0 text-[14px] font-semibold text-white"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          >
            {active.name}
          </motion.span>
        </AnimatePresence>
        <span className="min-w-0 truncate text-[12px] text-white/40">{snapshot.title}</span>
        <span className="ml-auto shrink-0 text-[12px] text-white/40 tabular-nums">
          {snapshot.todos.length > 0 && `${done}/${snapshot.todos.length}`}
        </span>
        <button
          type="button"
          onClick={onOpenChat}
          title={t("openInMali")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/60 hover:bg-white/[0.16] hover:text-white"
        >
          <ArrowUpRightIcon className="size-3" />
        </button>
      </div>
      <RollingSteps snapshot={snapshot} />
    </div>
  );
}

function iconOf(step: { kind: string; title: string }): LucideIcon {
  const verb = step.title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/^(run|bash|shell|exec|command)/.test(verb)) return TerminalIcon;
  if (/^(read|list|find|glob|open)/.test(verb)) return FileTextIcon;
  if (/^(write|edit|patch|update|create|copy|save)/.test(verb)) return PencilIcon;
  if (/^(search|grep)/.test(verb)) return SearchIcon;
  if (/^(fetch|web)/.test(verb)) return GlobeIcon;
  if (step.kind === "system") return SparklesIcon;
  return HammerIcon;
}

type Row = { key: string; title: string; icon: LucideIcon; tone: "past" | "now" | "next"; spin?: boolean };

/**
 * Lines that roll upward as the agent moves on: the step before (dim), the
 * one it's on (bright), and what its plan says comes next (dim).
 */
function rowsOf(snapshot: NotchSnapshot, t: NotchText): Row[] {
  const { steps } = snapshot;
  const at = currentStepIndex(steps);
  const rows: Row[] = [];
  const past = snapshot.phase === "done" ? steps.at(-1) : steps[at - 1];
  if (past) rows.push({ key: past.id, title: past.title, icon: CheckIcon, tone: "past" });
  if (snapshot.phase === "done") {
    rows.push({ key: "done", title: t("taskFinished"), icon: CheckIcon, tone: "now" });
    return rows;
  }
  const now = steps[at];
  rows.push(
    now
      ? { key: now.id, title: now.title, icon: iconOf(now), tone: "now", spin: !now.done }
      : { key: "start", title: t("startWorking"), icon: SparklesIcon, tone: "now", spin: true },
  );
  const next = snapshot.todos.find((t) => !isDone(t) && !isActive(t));
  if (next) rows.push({ key: `next:${next.id ?? next.text}`, title: next.text, icon: CircleIcon, tone: "next" });
  return rows;
}

function RollingSteps({ snapshot }: { snapshot: NotchSnapshot }) {
  const t = useNotchText();
  const rows = rowsOf(snapshot, t);
  return (
    <div className="flex flex-col gap-1 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        {rows.map((row) => {
          const Icon = row.icon;
          const now = row.tone === "now";
          return (
            <motion.div
              layout
              key={row.key}
              className={cn(
                "flex min-w-0 items-center gap-2",
                now ? "text-[15px] font-medium text-white" : "text-[13px] text-white/40",
              )}
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
            >
              <Icon className={cn("shrink-0", now ? "size-4" : "size-3.5")} />
              <span className="truncate">{row.title}</span>
              {row.spin && <Loader2Icon className="size-3 shrink-0 animate-spin text-white/40" />}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * The team: its name and a "New bot" button, then a chip per bot — tap one to
 * ask it directly; a bot at work shows what it's doing. With room left, a
 * dashed chip offers another bot; with no bots, the card invites making one.
 */
function TeamCard({ geometry, shape, roster, snapshot, active, onPickBot, onAddBot }: Props) {
  const t = useNotchText();
  const card = homeCards(geometry, shape, true).right!;
  const { bots, add } = teamSlots(card, roster.length);
  const extra = roster.length - bots.length;
  return (
    <>
      <div
        className="absolute flex items-center justify-between px-4"
        style={{ left: card.x, top: card.y, width: card.width, height: TEAM_HEADER }}
      >
        <span className="text-[11px] font-medium tracking-wide text-white/40 uppercase">
          {t("team")}
          {roster.length > 0 && <span className="ml-1.5 text-white/25 tabular-nums">{roster.length}</span>}
        </span>
        {roster.length > 0 && (
          <button
            type="button"
            onClick={onAddBot}
            title={t("newBotHint")}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <PlusIcon className="size-3" />
            {t("newBot")}
            {extra > 0 && <span className="text-white/30">· +{extra}</span>}
          </button>
        )}
      </div>
      {roster.length === 0 ? (
        <motion.div
          className="absolute flex flex-col items-center justify-center gap-2 px-6 text-center"
          style={{ left: card.x, top: card.y + TEAM_HEADER - 6, width: card.width, height: card.height - TEAM_HEADER }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
        >
          <p className="text-[13px] font-semibold text-white/80">{t("noBots")}</p>
          <p className="text-[11px] leading-snug text-white/40">{t("noBotsBody")}</p>
          <button
            type="button"
            onClick={onAddBot}
            className="mt-0.5 flex h-7 items-center gap-1 rounded-full bg-white px-3 text-[12px] font-semibold text-black transition-transform active:scale-95"
          >
            <PlusIcon className="size-3.5" />
            {t("newBot")}
          </button>
        </motion.div>
      ) : (
        <>
          {bots.map(({ chip }, i) => {
            const mate = roster[i];
            const run = snapshot.team.find((m) => m.id === mate.id);
            const working = !!run && !run.done;
            const stepped = mate.id === active.key;
            return (
              <motion.button
                type="button"
                key={mate.id}
                title={`${mate.name} — ${mate.role || t("askDirectly")}`}
                onClick={() => onPickBot(mate.id)}
                className="absolute flex items-center rounded-full border pr-3 text-left"
                style={{
                  left: chip.x,
                  top: chip.y,
                  width: chip.width,
                  height: chip.height,
                  paddingLeft: chip.height + 2,
                  background: `${mate.color}1f`,
                  borderColor: stepped ? `${mate.color}cc` : `${mate.color}55`,
                }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: 0.08 + i * 0.05 } }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
              >
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[13px] font-semibold text-white/90">{mate.name}</span>
                  <span className={cn("truncate text-[10.5px]", working ? "text-white/70" : "text-white/40")}>
                    {run ? run.status : mate.role || t("askDirectly")}
                  </span>
                </span>
              </motion.button>
            );
          })}
          {add && (
            <motion.button
              type="button"
              onClick={onAddBot}
              title={t("newBotHint")}
              className="absolute flex items-center justify-center gap-1.5 rounded-full border border-dashed border-white/20 text-[12px] text-white/45 transition-colors hover:border-white/40 hover:bg-white/[0.04] hover:text-white/80"
              style={{ left: add.x, top: add.y, width: add.width, height: add.height }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1, transition: { delay: 0.08 + bots.length * 0.05 } }}
              whileTap={{ scale: 0.96 }}
            >
              <PlusIcon className="size-3.5" />
              {t("newBot")}
            </motion.button>
          )}
        </>
      )}
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
          <div key={todo.id ?? i} className="flex min-w-0 items-center gap-2 text-[13px]">
            {finished ? (
              <CheckIcon className="size-3.5 shrink-0" style={{ color: GREEN }} />
            ) : active ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-white/70" />
            ) : (
              <CircleIcon className="size-3.5 shrink-0 text-white/25" />
            )}
            <span
              className={cn(
                "truncate",
                finished ? "text-white/35 line-through" : active ? "text-white" : "text-white/60",
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
      <div className="absolute rounded-[22px] bg-white/[0.05]" style={{ left: PAD, right: PAD, top, bottom: PAD }} />
      <div
        className="absolute flex min-w-0 flex-col gap-2.5"
        style={{ left: PAD + 14 + 72 + 16, right: PAD + 14, top: top + 12, bottom: PAD + 10 }}
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
          {snapshot.title && <span className="min-w-0 truncate text-white/45">· {snapshot.title}</span>}
          {more > 0 && <span className="ml-auto shrink-0 text-[11px] text-white/40">{t("more", { n: more })}</span>}
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
      <div className="absolute rounded-[22px] bg-white/[0.05]" style={{ left: PAD, right: PAD, top, bottom: PAD }} />
      <div className="absolute inset-x-0 flex justify-center" style={{ top: shape.height - PAD - 30 }}>
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
      <div className="absolute inset-x-0 flex flex-col items-center gap-2" style={{ top: top + 84 }}>
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
                animate={{ opacity: 1, y: 0, transition: { delay: 0.12 + i * 0.05 } }}
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

function PermissionGlow() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ background: `radial-gradient(120% 140% at 8% 70%, ${AMBER}55 0%, ${AMBER}1f 32%, transparent 62%)` }}
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
    <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5" style={{ height: top }}>
      <p className="truncate text-[12px] font-medium text-white/55" style={{ maxWidth: side }}>
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
      <div className="absolute right-6 bottom-5 left-[124px] flex flex-col justify-center gap-2.5" style={{ top }}>
        <div className="flex min-w-0 items-center gap-2 text-[15px]">
          <span
            className="notch-loop size-2 shrink-0 rounded-full bg-white"
            style={{ animation: "notch-fade 1.4s ease-in-out infinite" }}
          />
          <span className="truncate font-semibold">{snapshot.asker?.name ?? active.name}</span>
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
        className={cn("flex size-5 items-center justify-center rounded-md border text-[11px] font-medium", keyClass)}
      >
        {busy ? <Loader2Icon className="size-3 animate-spin" /> : hotkey}
      </span>
    </motion.button>
  );
}
