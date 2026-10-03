/**
 * How a Studio bot looks, and how it grows. A look is built from the parts
 * the cowork bots are made of (public/anim/cowork-bots.html), so a designed
 * bot has every pose the built-in ones have: thinking, working, a tool,
 * asking, celebrating. Parts open up as the bot levels up, and the bot
 * itself grows: ears come in, then the rest.
 */
import { BOT_IDS, type CoworkBotId } from "@/features/cowork-bot/store";
import { MAX_LEVEL } from "./constants";

export const EAR_KINDS = ["none", "cat", "bunny", "bear", "fox", "panda", "leaf", "tuft"] as const;
export const MOUTH_KINDS = ["smile", "cat"] as const;
export const SHAPES = ["round", "chubby", "tall"] as const;
export const MOVES = ["wave", "hop", "orbit", "snake"] as const;

export type EarKind = (typeof EAR_KINDS)[number];
export type MouthKind = (typeof MOUTH_KINDS)[number];
export type BodyShape = (typeof SHAPES)[number];
export type MoveKind = (typeof MOVES)[number];

export type BotLook = {
  /** The built-in bot it starts from: its wobble and morph. */
  base: CoworkBotId;
  /** Body color. */
  color: string;
  /** A second color the body drifts into (unlocks later). */
  color2?: string;
  ears: EarKind;
  /** Whose eyes it has (their shape and place). */
  eyes: CoworkBotId;
  eyeInk: string;
  mouth: MouthKind;
  blush: boolean;
  shape: BodyShape;
  /** How the three dots move while it works. */
  move: MoveKind;
};

/** The level each part opens at. */
export const UNLOCKS = {
  color: 1,
  eyes: 1,
  mouth: 1,
  shape: 1,
  ears: 2,
  blush: 4,
  move: 6,
  color2: 9,
  eyeInk: 12,
} as const satisfies Record<string, number>;

export type LookPart = keyof typeof UNLOCKS;

export function unlocked(part: LookPart, level: number) {
  return level >= UNLOCKS[part];
}

/** Parts that open exactly at `level`, for the level-up note. */
export function unlocksAt(level: number): LookPart[] {
  return (Object.keys(UNLOCKS) as LookPart[]).filter((part) => UNLOCKS[part] === level);
}

/** Growth stage from the level: what it's called and how grown it looks. */
export function stageOf(level: number) {
  if (level >= MAX_LEVEL) return { key: "grown", grown: 1 } as const;
  if (level >= 9) return { key: "adult", grown: 0.85 } as const;
  if (level >= 4) return { key: "teen", grown: 0.6 } as const;
  if (level >= 2) return { key: "kid", grown: 0.35 } as const;
  return { key: "baby", grown: 0 } as const;
}

/** Size in the Studio's preview: a bot that grew is bigger. */
export function previewSize(level: number) {
  return Math.round(64 + stageOf(level).grown * 56 + Math.min(level - 1, MAX_LEVEL - 1) * 1.2);
}

const BUILT_IN: Record<CoworkBotId, Omit<BotLook, "base" | "color">> = {
  mochi: { ears: "tuft", eyes: "mochi", eyeInk: "#000000", mouth: "smile", blush: false, shape: "chubby", move: "wave" },
  jelly: { ears: "leaf", eyes: "jelly", eyeInk: "#000000", mouth: "smile", blush: true, shape: "chubby", move: "hop" },
  petal: { ears: "bunny", eyes: "petal", eyeInk: "#000000", mouth: "smile", blush: true, shape: "round", move: "orbit" },
  nori: { ears: "cat", eyes: "nori", eyeInk: "#ffffff", mouth: "cat", blush: true, shape: "round", move: "snake" },
  sora: { ears: "bear", eyes: "sora", eyeInk: "#000000", mouth: "smile", blush: false, shape: "chubby", move: "hop" },
  momo: { ears: "cat", eyes: "momo", eyeInk: "#000000", mouth: "cat", blush: true, shape: "round", move: "orbit" },
  mikan: { ears: "fox", eyes: "mikan", eyeInk: "#000000", mouth: "cat", blush: true, shape: "chubby", move: "wave" },
  ichigo: { ears: "panda", eyes: "ichigo", eyeInk: "#000000", mouth: "smile", blush: false, shape: "round", move: "orbit" },
};

/** A first look: a built-in bot's parts in the chosen color. */
export function lookFrom(base: CoworkBotId, color: string): BotLook {
  return { base, color, ...BUILT_IN[base], eyeInk: inkFor(color) };
}

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(v as string) ? (v as T) : fallback;

/** A stored look, made safe; missing parts come from `fallback`. */
export function reviveLook(raw: unknown, fallback: BotLook): BotLook {
  const l = (raw ?? {}) as Partial<BotLook>;
  return {
    base: oneOf(BOT_IDS, l.base, fallback.base),
    color: isHex(l.color) ? l.color : fallback.color,
    color2: isHex(l.color2) ? l.color2 : undefined,
    ears: oneOf(EAR_KINDS, l.ears, fallback.ears),
    eyes: oneOf(BOT_IDS, l.eyes, fallback.eyes),
    eyeInk: isHex(l.eyeInk) ? l.eyeInk : fallback.eyeInk,
    mouth: oneOf(MOUTH_KINDS, l.mouth, fallback.mouth),
    blush: typeof l.blush === "boolean" ? l.blush : fallback.blush,
    shape: oneOf(SHAPES, l.shape, fallback.shape),
    move: oneOf(MOVES, l.move, fallback.move),
  };
}

// ── colors ──

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexOf([r, g, b]: number[]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}
function mix(a: string, b: string, f: number) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return hexOf(A.map((v, i) => v + (B[i]! - v) * f));
}

/** Eyes that show on this body: light ones on a dark color. */
export function inkFor(color: string) {
  const [r, g, b] = rgbOf(color);
  return 0.299 * r + 0.587 * g + 0.114 * b < 96 ? "#ffffff" : "#000000";
}

/** The engine's four stops for one color: highlight, light, the color, shade. */
function paletteOf(color: string) {
  return [mix(color, "#ffffff", 0.78), mix(color, "#ffffff", 0.32), color, mix(color, "#000000", 0.42)];
}

const SHAPE_ASPECT: Record<BodyShape, [number, number]> = {
  round: [1, 1],
  chubby: [1.08, 0.95],
  tall: [0.95, 1.06],
};

/**
 * What the animation draws: the look, as far as the level allows. Parts not
 * open yet stay as the built-in bot has them; a young bot is rounder and its
 * ears are still small.
 */
export function presetOf(look: BotLook, level: number, name?: string) {
  const parts = BUILT_IN[look.base];
  const { grown } = stageOf(level);
  const [ax, ay] = SHAPE_ASPECT[unlocked("shape", level) ? look.shape : parts.shape];
  // A baby is a little rounder, whatever shape it grows into.
  const aspect = [1 + (ax - 1) * (0.5 + grown / 2), 1 + (ay - 1) * (0.5 + grown / 2)];
  const main = paletteOf(look.color);
  const palettes = [main, paletteOf(mix(look.color, "#ffffff", 0.12)), paletteOf(mix(look.color, "#000000", 0.08))];
  if (look.color2 && unlocked("color2", level)) palettes.splice(1, 0, paletteOf(look.color2));
  return {
    name,
    base: look.base,
    palettes,
    aspect,
    eyes: look.eyes,
    eyeInk: unlocked("eyeInk", level) ? look.eyeInk : inkFor(look.color),
    mouth: look.mouth,
    blush: unlocked("blush", level) ? look.blush : false,
    ears: unlocked("ears", level) ? look.ears : "none",
    // Ears grow in with the bot.
    earScale: 0.55 + 0.45 * grown,
    work: unlocked("move", level) ? look.move : parts.move,
    layout: (unlocked("move", level) ? look.move : parts.move) === "orbit" ? "tri" : "line",
  };
}
