"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import { type BotState, type CoworkBotId } from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const ACTOR_COUNT = 5;
const PLAY_BOTS: CoworkBotId[] = ["mochi", "jelly", "petal", "nori", "momo", "sora", "mikan", "ichigo"];
/** Room kept between a bot and the text or cards it walks around. */
const MARGIN = 10;
const WALK_SPEED = 70; // px/s
const FLY_SPEED = 190; // px/s

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Mode = "rest" | "walk" | "fly" | "spin" | "vanish" | "appear";

/** One bot's body, moved every frame without a React render. */
type Actor = {
  bot: CoworkBotId;
  size: number;
  x: number;
  y: number;
  mode: Mode;
  /** When the current move started and how long it lasts, in seconds. */
  t0: number;
  dur: number;
  from: Point;
  to: Point;
  /** Control point of a flight's arc. */
  via: Point;
  facing: 1 | -1;
  phase: number;
};

type Poof = { id: number; x: number; y: number };

const shuffle = <T,>(items: readonly T[]) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

function overlaps(a: Box, b: Box, gap: number) {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

function bezier(a: Point, c: Point, b: Point, p: number): Point {
  const q = 1 - p;
  return { x: q * q * a.x + 2 * q * p * c.x + p * p * b.x, y: q * q * a.y + 2 * q * p * c.y + p * p * b.y };
}

/**
 * Empty-chat Mali bots: little creatures that play around the page while
 * nothing has been said yet. They toddle, fly on small wings, spin, and
 * vanish in a puff to pop up somewhere else, always around the welcome text,
 * the cards and each other, never over them.
 *
 * Put it inside the empty area (a positioned parent); anything in that parent
 * marked `data-bot-avoid` is kept clear.
 */
export function AnimationBotMali({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const fieldRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const wings = useRef<(HTMLDivElement | null)[]>([]);
  const actors = useRef<Actor[]>([]);
  const obstacles = useRef<Box[]>([]);
  const bounds = useRef({ w: 0, h: 0 });
  const [cast, setCast] = useState<{ bot: CoworkBotId; size: number; state: BotState }[]>([]);
  const [poofs, setPoofs] = useState<Poof[]>([]);

  useEffect(() => {
    const field = fieldRef.current;
    const area = field?.parentElement;
    if (!field || !area) return;

    // What the bots stay clear of, in the field's own coordinates.
    const measure = () => {
      const origin = field.getBoundingClientRect();
      bounds.current = { w: origin.width, h: origin.height };
      obstacles.current = Array.from(area.querySelectorAll<HTMLElement>("[data-bot-avoid]"))
        .flatMap((el) => {
          // Text is measured by its lines, cards by their boxes.
          const parts = el.dataset.botAvoid === "children" ? Array.from(el.children) : [el];
          return parts.map((part) => part.getBoundingClientRect());
        })
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }));
    };

    const blocked = (box: Box, self: number, checkPeers: boolean) =>
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.w > bounds.current.w ||
      box.y + box.h > bounds.current.h ||
      obstacles.current.some((o) => overlaps(box, o, MARGIN)) ||
      (checkPeers &&
        actors.current.some((a, i) => {
          if (i === self) return false;
          const at = a.mode === "rest" || a.mode === "spin" ? { x: a.x, y: a.y } : a.to;
          return overlaps(box, { x: at.x, y: at.y, w: a.size, h: a.size }, 6);
        }));

    const freeSpot = (size: number, self: number): Point | null => {
      const { w, h } = bounds.current;
      for (let tries = 0; tries < 80; tries++) {
        const p = { x: Math.random() * Math.max(1, w - size), y: Math.random() * Math.max(1, h - size) };
        if (!blocked({ ...p, w: size, h: size }, self, true)) return p;
      }
      return null;
    };

    /** Clear of the text and cards all along the way. */
    const pathClear = (size: number, at: (p: number) => Point, self: number) => {
      for (let i = 1; i < 16; i++) {
        const p = at(i / 16);
        if (blocked({ x: p.x, y: p.y, w: size, h: size }, self, false)) return false;
      }
      return true;
    };

    measure();
    const roster = shuffle(PLAY_BOTS).slice(0, ACTOR_COUNT);
    actors.current = [];
    roster.forEach((bot, i) => {
      const size = 58 + Math.round(Math.random() * 16);
      const spot = freeSpot(size, i) ?? { x: (i / ACTOR_COUNT) * Math.max(0, bounds.current.w - size), y: 0 };
      actors.current.push({
        bot,
        size,
        ...spot,
        mode: "appear",
        t0: performance.now() / 1000 + i * 0.25,
        dur: 0.5,
        from: spot,
        to: spot,
        via: spot,
        facing: Math.random() < 0.5 ? 1 : -1,
        phase: Math.random() * 10,
      });
    });
    setCast(roster.map((bot, i) => ({ bot, size: actors.current[i]!.size, state: "idle" })));

    const setState = (i: number, state: BotState) =>
      setCast((prev) => (prev[i]?.state === state ? prev : prev.map((c, k) => (k === i ? { ...c, state } : c))));

    let poofId = 0;
    const poof = (a: Actor) => {
      const id = ++poofId;
      setPoofs((prev) => [...prev, { id, x: a.x + a.size / 2, y: a.y + a.size / 2 }]);
      window.setTimeout(() => setPoofs((prev) => prev.filter((p) => p.id !== id)), 700);
    };

    /** What to do next, once a move ends. */
    const nextMove = (a: Actor, i: number, now: number) => {
      const roll = Math.random();
      const target = freeSpot(a.size, i);
      a.t0 = now;
      a.from = { x: a.x, y: a.y };
      if (roll < 0.3 || !target) {
        a.mode = "rest";
        a.dur = 1.6 + Math.random() * 2.8;
        setState(i, Math.random() < 0.18 ? "welcome" : "idle");
        return;
      }
      a.to = target;
      const dist = Math.hypot(target.x - a.x, target.y - a.y);
      if (Math.abs(target.x - a.x) > 4) a.facing = target.x > a.x ? 1 : -1;
      setState(i, "idle");

      if (roll < 0.42) {
        a.mode = "spin";
        a.to = a.from;
        a.dur = 0.9;
        return;
      }
      if (roll < 0.56) {
        a.mode = "vanish";
        a.dur = 0.32;
        poof(a);
        return;
      }
      // Walk when the straight way is clear and not too far; otherwise fly over.
      const walkable = dist < 260 && pathClear(a.size, (p) => ({ x: a.x + (target.x - a.x) * p, y: a.y + (target.y - a.y) * p }), i);
      if (walkable && roll < 0.8) {
        a.mode = "walk";
        a.dur = Math.max(0.6, dist / WALK_SPEED);
        return;
      }
      // Arc up and over; a higher arc if the low one would brush the text.
      for (const lift of [50, 90, 140, 200]) {
        const via = { x: (a.x + target.x) / 2, y: Math.max(0, Math.min(a.y, target.y) - lift - dist * 0.15) };
        if (pathClear(a.size, (p) => bezier(a.from, via, target, p), i)) {
          a.mode = "fly";
          a.via = via;
          a.dur = 0.8 + dist / FLY_SPEED;
          return;
        }
      }
      // No clear way there: disappear and pop up instead.
      a.mode = "vanish";
      a.dur = 0.32;
      poof(a);
    };

    let raf = 0;
    const frame = () => {
      const now = performance.now() / 1000;
      actors.current.forEach((a, i) => {
        const node = nodes.current[i];
        const wing = wings.current[i];
        if (!node) return;
        const p = clamp((now - a.t0) / a.dur, 0, 1);
        let y = 0;
        let rot = 0;
        let scale = 1;
        let opacity = 1;
        let wingOn = 0;
        a.phase += 1 / 60;

        switch (a.mode) {
          case "rest": {
            // Pushed into by text that moved (cards loading in): hop out of the way.
            if (blocked({ x: a.x, y: a.y, w: a.size, h: a.size }, i, false)) {
              a.mode = "vanish";
              a.t0 = now;
              a.dur = 0.32;
              a.to = freeSpot(a.size, i) ?? { x: a.x, y: a.y };
              poof(a);
            }
            break;
          }
          case "walk": {
            const e = ease(p);
            a.x = a.from.x + (a.to.x - a.from.x) * e;
            a.y = a.from.y + (a.to.y - a.from.y) * e;
            y = -Math.abs(Math.sin(a.phase * 9)) * 5;
            rot = Math.sin(a.phase * 9) * 5;
            break;
          }
          case "fly": {
            // Wings open first, then off it goes; they fold after landing.
            const at = bezier(a.from, a.via, a.to, ease(p));
            a.x = at.x;
            a.y = at.y;
            wingOn = Math.min(1, p * 6, (1 - p) * 6);
            y = Math.sin(a.phase * 5) * 3 * wingOn;
            rot = Math.sin(a.phase * 2.5) * 6 * wingOn;
            break;
          }
          case "spin": {
            rot = 360 * ease(p);
            y = -Math.sin(Math.PI * p) * 16;
            scale = 1 + Math.sin(Math.PI * p) * 0.08;
            break;
          }
          case "vanish": {
            scale = 1 - p;
            rot = 200 * p;
            opacity = 1 - p;
            break;
          }
          case "appear": {
            const s = p < 0.7 ? (p / 0.7) * 1.12 : 1.12 - ((p - 0.7) / 0.3) * 0.12;
            scale = Math.max(0, s);
            rot = -120 * (1 - p);
            opacity = Math.min(1, p * 2);
            break;
          }
        }

        if (p >= 1) {
          if (a.mode === "vanish") {
            a.x = a.to.x;
            a.y = a.to.y;
            a.mode = "appear";
            a.t0 = now;
            a.dur = 0.45;
            poof(a);
          } else if (a.mode === "rest" || a.mode === "appear" || a.mode === "walk" || a.mode === "spin") {
            if (a.mode === "rest") nextMove(a, i, now);
            else {
              a.mode = "rest";
              a.t0 = now;
              a.dur = 1 + Math.random() * 2.5;
            }
          } else if (a.mode === "fly") {
            a.mode = "rest";
            a.t0 = now;
            a.dur = 1.4 + Math.random() * 2;
            // Happy to have landed, now and then.
            if (Math.random() < 0.35) setState(i, "done");
          }
        }

        node.style.transform = `translate(${a.x.toFixed(1)}px, ${(a.y + y).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${(scale * a.facing).toFixed(3)}, ${scale.toFixed(3)})`;
        node.style.opacity = opacity.toFixed(3);
        if (wing) {
          wing.style.opacity = wingOn.toFixed(3);
          wing.style.transform = `scale(${(0.4 + 0.6 * wingOn).toFixed(3)})`;
        }
      });
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => measure();
    const ro = new ResizeObserver(onResize);
    ro.observe(area);
    // Cards and the title settle in after the page opens; keep the map fresh.
    const refresh = window.setInterval(measure, 1000);

    let still = 0;
    if (reduceMotion) {
      // Still there to say hello, just not running about. Placed once the
      // bots have rendered.
      still = window.setTimeout(() => {
        actors.current.forEach((a, i) => {
          const node = nodes.current[i];
          if (!node) return;
          a.mode = "rest";
          node.style.transform = `translate(${a.x}px, ${a.y}px)`;
          node.style.opacity = "1";
        });
      }, 60);
    } else {
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(still);
      ro.disconnect();
      window.clearInterval(refresh);
    };
  }, [reduceMotion]);

  return (
    <div ref={fieldRef} className={cn("pointer-events-none absolute inset-0 z-10 overflow-hidden", className)} aria-hidden>
      <style>{`
        @keyframes mali-wing-l { 0%,100% { transform: rotate(18deg) } 50% { transform: rotate(-26deg) } }
        @keyframes mali-wing-r { 0%,100% { transform: rotate(-18deg) } 50% { transform: rotate(26deg) } }
        @keyframes mali-poof { 0% { transform: translate(0,0) scale(.4); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(1); opacity: 0 } }
      `}</style>

      {cast.map((c, i) => (
        <div
          key={c.bot}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          className="absolute top-0 left-0 will-change-transform"
          style={{ width: c.size, height: c.size, opacity: 0 }}
        >
          {/* Wings sit behind the body and flap while it flies. */}
          <div
            ref={(el) => {
              wings.current[i] = el;
            }}
            className="absolute inset-0"
            style={{ opacity: 0, transformOrigin: "50% 55%" }}
          >
            <Wing side="left" size={c.size} />
            <Wing side="right" size={c.size} />
          </div>
          <CoworkBot bot={c.bot} state={c.state} size={c.size} className="relative" />
        </div>
      ))}

      {poofs.map((p) => (
        <div key={p.id} className="absolute" style={{ left: p.x, top: p.y }}>
          {Array.from({ length: 8 }, (_, k) => {
            const a = (k / 8) * Math.PI * 2;
            return (
              <span
                key={k}
                className="absolute block size-2 rounded-full"
                style={{
                  background: ["#f5c518", "#34c77b", "#8b5cf6", "#3aa3f5", "#f7609f"][k % 5],
                  ["--dx" as string]: `${Math.cos(a) * 30}px`,
                  ["--dy" as string]: `${Math.sin(a) * 30}px`,
                  animation: "mali-poof .6s ease-out forwards",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A small feathered wing; the right one is the left one mirrored. */
function Wing({ side, size }: { side: "left" | "right"; size: number }) {
  const w = size * 0.62;
  return (
    <svg
      viewBox="0 0 60 44"
      width={w}
      height={w * (44 / 60)}
      className="absolute drop-shadow-sm"
      style={{
        top: size * 0.18,
        [side === "left" ? "right" : "left"]: size * 0.68,
        transformOrigin: side === "left" ? "100% 70%" : "0% 70%",
        animation: `${side === "left" ? "mali-wing-l" : "mali-wing-r"} .32s ease-in-out infinite`,
      }}
      aria-hidden
    >
      <g transform={side === "right" ? "translate(60 0) scale(-1 1)" : undefined}>
        <path
          d="M60 30C48 8 22 0 4 6c7 3 10 7 11 11-6-1-11 1-13 5 7 0 11 3 12 7-4 1-7 3-8 7 12-4 30-2 54-6Z"
          fill="#ffffff"
          stroke="rgba(120,130,160,.45)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M52 27C42 16 30 12 20 12M50 30C40 24 30 22 22 23" fill="none" stroke="rgba(120,130,160,.35)" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
