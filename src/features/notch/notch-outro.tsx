/**
 * Opening the app from the notch: a drop swells under the pill, pinches off
 * and falls into the middle of the main window, which opens out of it as it
 * lands (`notch-mode.ts`). The pill's window covers the screen down to the
 * main window while this plays and lets clicks through (`notch_drop_out`).
 */
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NotchDropTarget } from "./bridge";

const DROP = 26;
/** Swelling under the pill, falling, then the splash as the app opens. */
const FORM_S = 0.42;
const FALL_S = 0.48;
const SPLASH_MS = 520;
/** Falling: slow, then faster, like a drop. */
const GRAVITY = [0.5, 0, 0.9, 0.55] as const;

type Props = {
  target: NotchDropTarget;
  /** The bot's color, for the drop's light. */
  color: string;
  /** Where the pill's wings end. */
  top: number;
  /** The drop reached the window: open it now, so it opens out of the drop. */
  onLanded: () => void;
  /** The splash is over. */
  onDone: () => void;
};

export function NotchOutro({ target, color, top, onLanded, onDone }: Props) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [cx, setCx] = useState<number>();
  const [stage, setStage] = useState<"form" | "fall" | "splash">("form");
  useLayoutEffect(() => setCx((box.current?.offsetWidth ?? window.innerWidth) / 2), []);

  const landed = useRef(onLanded);
  landed.current = onLanded;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!reduced) return;
    landed.current();
    done.current();
  }, [reduced]);
  useEffect(() => {
    if (stage !== "splash") return;
    landed.current();
    const timer = setTimeout(() => done.current(), SPLASH_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  if (reduced || cx === undefined) return <div ref={box} className="pointer-events-none absolute inset-0" />;

  const land = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  /** Where the drop lets go of the pill. */
  const hang = top + 30;
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden">
      {stage === "form" && <Swell cx={cx} top={top} hang={hang} color={color} onDone={() => setStage("fall")} />}
      {stage === "fall" && (
        <>
          {/* The light it leaves behind on the way down, aimed where it lands. */}
          <div
            className="absolute w-[2px] origin-top"
            style={{
              left: cx - 1,
              top: hang,
              height: Math.hypot(land.x - cx, land.y - hang),
              transform: `rotate(${Math.atan2(cx - land.x, land.y - hang)}rad)`,
            }}
          >
            <motion.div
              className="size-full origin-top rounded-full"
              style={{
                background: `linear-gradient(180deg, transparent, ${color}99 70%, white)`,
                boxShadow: `0 0 10px 1px ${color}66`,
              }}
              initial={{ scaleY: 0, opacity: 0.9 }}
              animate={{ scaleY: 1, opacity: [0.9, 0.9, 0] }}
              transition={{ duration: FALL_S, ease: GRAVITY, opacity: { duration: FALL_S + 0.2, times: [0, 0.7, 1] } }}
            />
          </div>
          <motion.div
            className="absolute rounded-full"
            style={{ width: DROP, height: DROP, left: -DROP / 2, top: -DROP / 2 }}
            initial={{ x: cx, y: hang, scaleX: 1, scaleY: 1, background: "#000", boxShadow: glow(color, 0.5) }}
            animate={{
              x: land.x,
              y: land.y,
              // Drawn out as it speeds up, and lit up as it nears the window.
              scaleX: [1, 0.86, 0.8],
              scaleY: [1, 1.22, 1.32],
              background: ["#000000", "#2b2b2b", "#ffffff"],
              boxShadow: [glow(color, 0.5), glow(color, 0.8), glow(color, 1.2)],
            }}
            transition={{ duration: FALL_S, ease: GRAVITY }}
            onAnimationComplete={() => setStage("splash")}
          />
        </>
      )}
      {stage === "splash" && <Splash at={land} target={target} color={color} />}
    </div>
  );
}

function glow(color: string, strength: number) {
  return `0 0 ${Math.round(14 * strength)}px ${Math.round(4 * strength)}px rgba(255,255,255,${(0.45 * strength).toFixed(2)}), 0 0 ${Math.round(40 * strength)}px ${Math.round(12 * strength)}px ${color}88`;
}

/**
 * The drop swelling under the pill and pinching off. A goo filter melts the
 * drop into a bead of the pill's edge, so the neck between them stretches
 * thin and lets go; it runs only on this small area, only for this moment.
 */
function Swell({
  cx,
  top,
  hang,
  color,
  onDone,
}: {
  cx: number;
  top: number;
  hang: number;
  color: string;
  onDone: () => void;
}) {
  const width = 120;
  const height = hang + DROP;
  return (
    <>
      <svg className="absolute" width="0" height="0" aria-hidden>
        <defs>
          <filter id="notch-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
          </filter>
        </defs>
      </svg>
      <div className="absolute top-0" style={{ left: cx - width / 2, width, height, filter: "url(#notch-goo)" }}>
        {/* A bead of the pill's lower edge the drop pulls away from. */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
          style={{ top: top - 14 }}
          initial={{ width: 70, height: 20 }}
          animate={{ width: [70, 46, 40], height: [20, 24, 18] }}
          transition={{ duration: FORM_S, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute rounded-full bg-black"
          style={{ left: width / 2 - DROP / 2, width: DROP, height: DROP, top: -DROP / 2 }}
          initial={{ y: top - 4, scale: 0.3 }}
          animate={{ y: [top - 4, top + 8, hang], scale: [0.3, 0.85, 1] }}
          transition={{ duration: FORM_S, ease: [0.45, 0, 0.6, 1], times: [0, 0.55, 1] }}
          onAnimationComplete={onDone}
        />
      </div>
      {/* Its light, coming up as it swells (outside the goo, which would melt it). */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: DROP, height: DROP, left: cx - DROP / 2, top: -DROP / 2 }}
        initial={{ y: top - 4, opacity: 0, scale: 0.3 }}
        animate={{ y: [top - 4, top + 8, hang], opacity: [0, 0.4, 1], scale: [0.3, 0.85, 1] }}
        transition={{ duration: FORM_S, ease: [0.45, 0, 0.6, 1], times: [0, 0.55, 1] }}
      >
        <div className="size-full rounded-full" style={{ boxShadow: glow(color, 0.5) }} />
      </motion.div>
    </>
  );
}

/** The landing: the drop flattens, a ring runs out, and the window's outline flashes as it opens. */
function Splash({ at, target, color }: { at: { x: number; y: number }; target: NotchDropTarget; color: string }) {
  return (
    <>
      <motion.div
        className="absolute rounded-full bg-white"
        style={{ width: DROP, height: DROP, left: at.x - DROP / 2, top: at.y - DROP / 2, boxShadow: glow(color, 1.2) }}
        initial={{ scaleX: 0.8, scaleY: 1.32, opacity: 1 }}
        animate={{ scaleX: [0.8, 1.7, 0.6], scaleY: [1.32, 0.5, 0.6], opacity: [1, 1, 0] }}
        transition={{ duration: 0.3, ease: "easeOut", times: [0, 0.35, 1] }}
      />
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 40,
          height: 40,
          left: at.x - 20,
          top: at.y - 20,
          border: `2px solid ${color}`,
          boxShadow: `0 0 18px ${color}aa`,
        }}
        initial={{ scale: 0.4, opacity: 0.9 }}
        animate={{ scale: 5.5, opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
      />
      <motion.div
        className="absolute rounded-[18px]"
        style={{
          left: target.x,
          top: target.y,
          width: target.width,
          height: target.height,
          border: `1.5px solid ${color}`,
          boxShadow: `0 0 40px ${color}55, inset 0 0 30px ${color}33`,
        }}
        initial={{ scale: 0.12, opacity: 0 }}
        animate={{ scale: [0.12, 1], opacity: [0, 0.8, 0] }}
        transition={{ duration: 0.5, ease: [0.3, 0, 0.15, 1], opacity: { times: [0, 0.4, 1], duration: 0.5 } }}
      />
    </>
  );
}
