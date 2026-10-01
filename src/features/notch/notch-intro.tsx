/**
 * Going into notch mode: the main window has shrunk to a dot where it was;
 * the dot floats up to the notch, a line of light runs along the top edge,
 * then the pill opens. The window covers the screen down to the dot while
 * this plays and lets clicks through (`notch_enter_mode`).
 */
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { NotchPoint } from "./bridge";

const DOT = 26;

export function NotchIntro({ from, color, onDone }: { from: NotchPoint; color: string; onDone: () => void }) {
  const [stage, setStage] = useState<"fly" | "glow">("fly");
  const box = useRef<HTMLDivElement>(null);
  const [cx, setCx] = useState<number>();
  useLayoutEffect(() => setCx((box.current?.offsetWidth ?? window.innerWidth) / 2), []);
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden">
      {cx !== undefined && stage === "fly" && (
        <motion.div
          className="absolute rounded-full bg-white"
          style={{
            width: DOT,
            height: DOT,
            left: -DOT / 2,
            top: -DOT / 2,
            boxShadow: `0 0 18px 6px rgba(255,255,255,0.6), 0 0 54px 18px ${color}88`,
          }}
          initial={{ x: from.x, y: from.y, scale: 1.6, opacity: 0 }}
          // Up in a soft curve: rises first, then drifts to the middle.
          animate={{
            x: [from.x, from.x + (cx - from.x) * 0.3, cx],
            y: [from.y, from.y * 0.38, 2],
            scale: [1.6, 1, 0.4],
            opacity: [0, 1, 1],
          }}
          transition={{ duration: 0.8, ease: [0.55, 0, 0.25, 1], times: [0, 0.5, 1] }}
          onAnimationComplete={() => setStage("glow")}
        />
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
