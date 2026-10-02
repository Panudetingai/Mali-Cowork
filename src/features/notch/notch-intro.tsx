/**
 * Going into notch mode: a dot rises from the middle of the screen straight
 * up into the notch, a line of light runs along the top edge, then the pill
 * opens. The window covers the screen down to the dot while this plays,
 * above every other window, and lets clicks through (`notch_enter_mode`).
 * Without a dot, only the light plays.
 */
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NotchPoint } from "./bridge";

const DOT = 30;
/** The window grows to cover the dot's way up; a web view is blank until that resize draws. */
const GROW_WAIT_MS = 450;

export function NotchIntro({ from, color, onDone }: { from: NotchPoint | null; color: string; onDone: () => void }) {
  const [stage, setStage] = useState<"wait" | "fly" | "glow">(from ? "wait" : "glow");
  const box = useRef<HTMLDivElement>(null);
  const [cx, setCx] = useState<number>();
  useLayoutEffect(() => setCx((box.current?.offsetWidth ?? window.innerWidth) / 2), []);
  // Fly once the window reaches down to the dot (or soon anyway), so the
  // dot isn't drawn into a window that's still the pill's small one.
  useEffect(() => {
    if (stage !== "wait" || !from) return;
    const go = () => {
      setCx((box.current?.offsetWidth ?? window.innerWidth) / 2);
      setStage("fly");
    };
    if (window.innerHeight >= from.y + DOT) return go();
    const onResize = () => {
      if (window.innerHeight >= from.y + DOT) go();
    };
    window.addEventListener("resize", onResize);
    const timer = setTimeout(go, GROW_WAIT_MS);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timer);
    };
  }, [stage, from]);
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {cx !== undefined && from && stage === "fly" && (
        <>
          {/* Its trail, rising behind it. */}
          <motion.div
            className="absolute w-[3px] rounded-full"
            style={{
              left: cx - 1.5,
              top: 0,
              height: from.y,
              transformOrigin: "50% 100%",
              background: `linear-gradient(to top, transparent, ${color}cc 40%, white)`,
              filter: "blur(1px)",
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: [0, 1, 1], opacity: [0, 0.8, 0] }}
            transition={{ duration: 0.8, ease: [0.55, 0, 0.25, 1], times: [0, 0.6, 1] }}
          />
          <motion.div
            className="absolute rounded-full bg-white"
            style={{
              width: DOT,
              height: DOT,
              left: cx - DOT / 2,
              top: -DOT / 2,
              boxShadow: `0 0 18px 6px rgba(255,255,255,0.7), 0 0 60px 22px ${color}99`,
            }}
            initial={{ y: from.y, scale: 0.2, opacity: 0 }}
            // Swells where it starts, then rises straight up the middle into the notch.
            animate={{ y: [from.y, from.y, 2], scale: [0.2, 1.5, 0.4], opacity: [0, 1, 1] }}
            transition={{ duration: 0.95, ease: [0.55, 0, 0.25, 1], times: [0, 0.25, 1] }}
            onAnimationComplete={() => setStage("glow")}
          />
        </>
      )}
      {cx !== undefined && stage === "glow" && (
        <>
          {/* The line along the top edge, spreading out from the notch. */}
          <motion.div
            className="absolute top-0 h-[3px] rounded-full"
            style={{
              left: cx,
              x: "-50%",
              background: `linear-gradient(90deg, transparent, ${color}, white, ${color}, transparent)`,
              boxShadow: `0 0 12px 2px ${color}aa`,
            }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: ["0%", "70%", "90%"], opacity: [0, 1, 0] }}
            transition={{ duration: 0.75, ease: "easeOut", times: [0, 0.55, 1] }}
            onAnimationComplete={onDone}
          />
          {/* Its glow, falling a little way down the screen. */}
          <motion.div
            className="absolute top-0 h-24 blur-2xl"
            style={{
              left: cx,
              x: "-50%",
              background: `radial-gradient(50% 100% at 50% 0%, ${color}66, transparent)`,
            }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: ["0%", "60%", "70%"], opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.75, ease: "easeOut", times: [0, 0.5, 1] }}
          />
        </>
      )}
    </div>
  );
}
