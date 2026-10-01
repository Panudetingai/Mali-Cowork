/**
 * The pill's measurements, in logical pixels. The shape animates between
 * these inside the window; the window is sized to the shape plus room for
 * its shadow and the curved "ears" where it meets the top of the screen.
 *
 * Nothing is drawn where the camera is: the top row keeps clear of the notch
 * and a little either side of it, since the housing's corners curve.
 */
import type { NotchGeometry, NotchView } from "./types";

/** Each side of the notch the collapsed pill reaches out by. */
export const WING = 46;
/** The concave curve where the pill meets the top edge. */
export const EAR = 10;
/** Kept clear either side of the camera housing. */
export const CAMERA_GAP = 12;
/** Room around the open pill for its shadow. */
const SHADOW = 28;
/** Height of the collapsed pill without a menu bar to match (Windows). */
const ISLAND = 34;
/** Width of the collapsed pill without a notch to wrap: it carries the step text. */
const ISLAND_WIDTH = 300;
/** Inset of the open pill's cards from its edges. */
export const PAD = 12;
/** Height of the open pill's body under the top row, per view. */
const BODY = { home: 168, welcome: 150, drop: 150, permission: 136 } as const;

/** Height of the chat's input bar, the file row above it, and the thread above that. */
export const CHAT_INPUT = 52;
/** Thumbnails of the attached files sit above the input. */
const CHAT_FILES = 60;
const CHAT_THREAD = 280;
/** The bot beside the chat's input. */
export const CHAT_BOT = 34;

export type Size = { width: number; height: number };
export type Frame = { x: number; y: number; size: number };
export type Box = { x: number; y: number; width: number; height: number };

/** What the chat view holds besides its input. */
export type ChatFill = { thread: boolean; files: boolean };

/** The collapsed pill matches the menu bar (the notch's height on a notched Mac). */
export function barOf(geometry: NotchGeometry) {
  return geometry.barHeight > 0 ? geometry.barHeight : ISLAND;
}

/** The open pill's top row: level with the notch, never cramped. */
export function topRowOf(geometry: NotchGeometry) {
  return Math.max(barOf(geometry), 32);
}

/** The width the camera takes, with its clearance; 0 without a notch. */
export function cameraOf(geometry: NotchGeometry) {
  return geometry.hasNotch ? geometry.notchWidth + 2 * CAMERA_GAP : 0;
}

/** Room for the top row's content either side of the camera. */
export function sideOf(geometry: NotchGeometry, shape: Size) {
  return (shape.width - cameraOf(geometry)) / 2 - 16;
}

function openWidth(geometry: NotchGeometry, min: number) {
  return Math.max(min, geometry.notchWidth + 2 * WING + 2 * CAMERA_GAP);
}

export function shapeSize(view: NotchView, geometry: NotchGeometry, fill?: ChatFill): Size {
  const top = topRowOf(geometry);
  switch (view) {
    case "collapsed":
      return {
        width: geometry.hasNotch ? geometry.notchWidth + 2 * WING : ISLAND_WIDTH,
        height: barOf(geometry),
      };
    case "chat": {
      const body = 4 + CHAT_INPUT + (fill?.files ? CHAT_FILES : 0) + (fill?.thread ? CHAT_THREAD : 0) + PAD;
      return { width: openWidth(geometry, 640), height: top + body };
    }
    case "permission":
      return { width: openWidth(geometry, 600), height: top + BODY.permission };
    default:
      return { width: openWidth(geometry, 640), height: top + BODY[view] };
  }
}

/**
 * The pill's window: one fixed size that holds every view (the tallest is the
 * ask box with a thread and files) with room for the shadow. The pill
 * animates inside it; resizing a web view blanks it for a moment, which is
 * what flickered. Outside the pill, clicks go through (`hitArea`).
 */
export function pillWindow(geometry: NotchGeometry): Size {
  const views: NotchView[] = ["home", "welcome", "drop", "permission"];
  const tallest = shapeSize("chat", geometry, { thread: true, files: true });
  const widest = Math.max(tallest.width, ...views.map((v) => shapeSize(v, geometry).width));
  return { width: widest + 2 * SHADOW, height: tallest.height + SHADOW };
}

/** Where the pill is in its window, ears included: the part that takes clicks. */
export function hitArea(window: Size, shape: Size): Box {
  return { x: (window.width - shape.width) / 2 - EAR, y: 0, width: shape.width + 2 * EAR, height: shape.height };
}

export function windowSize(view: NotchView, shape: Size): Size {
  const open = view !== "collapsed";
  const side = open ? SHADOW : EAR;
  return { width: shape.width + 2 * side, height: shape.height + (open ? SHADOW : 0) };
}

/** The home view's two cards: the run (or the greeting) left, the team right. */
export function homeCards(geometry: NotchGeometry, shape: Size, split: boolean): { left: Box; right?: Box } {
  const top = topRowOf(geometry);
  const height = shape.height - top - PAD;
  if (!split) return { left: { x: PAD, y: top, width: shape.width - 2 * PAD, height } };
  const width = (shape.width - 2 * PAD - 10) / 2;
  return {
    left: { x: PAD, y: top, width, height },
    right: { x: PAD + width + 10, y: top, width, height },
  };
}

/** Bots shown on Home's team card; the rest are a "+N". */
export const TEAM_SHOWN = 4;
/** The team card's own row: its name, and adding a bot. */
export const TEAM_HEADER = 30;

/**
 * The team card: a header, then one chip per bot (the bot sits at the chip's
 * left) and, while there's room, a dashed "New bot" chip. One or two chips
 * get a full-width row each; three or four make a two-by-two grid.
 */
export function teamSlots(card: Box, bots: number): { bots: { chip: Box; bot: Frame }[]; add?: Box } {
  const shown = Math.min(bots, TEAM_SHOWN);
  const count = shown + (shown < TEAM_SHOWN ? 1 : 0);
  const columns = count <= 2 ? 1 : 2;
  const gap = 8;
  const height = columns === 1 ? 44 : 40;
  const rows = Math.ceil(count / columns);
  const width = (card.width - 2 * PAD - (columns - 1) * gap) / columns;
  const area = { y: card.y + TEAM_HEADER, height: card.height - TEAM_HEADER - PAD };
  const top = area.y + (area.height - (rows * height + (rows - 1) * gap)) / 2;
  const boxes = Array.from({ length: count }, (_, i) => ({
    x: card.x + PAD + (i % columns) * (width + gap),
    y: top + Math.floor(i / columns) * (height + gap),
    width,
    height,
  }));
  const size = height - 10;
  return {
    bots: boxes.slice(0, shown).map((chip) => ({ chip, bot: { x: chip.x + 5, y: chip.y + 5, size } })),
    add: count > shown ? boxes[shown] : undefined,
  };
}

/** Where the main bot sits in the shape for each view. */
export function mascotFrame(view: NotchView, geometry: NotchGeometry, shape: Size): Frame {
  const top = topRowOf(geometry);
  const body = shape.height - top;
  switch (view) {
    case "collapsed": {
      const bar = barOf(geometry);
      const size = Math.min(24, bar - 6);
      return { x: (WING - size) / 2 + 2, y: (bar - size) / 2, size };
    }
    case "home": {
      const size = 84;
      return { x: PAD + 18, y: top + (body - PAD - size) / 2, size };
    }
    case "welcome": {
      const size = 96;
      return { x: (shape.width - size) / 2, y: top + (body - PAD - size) / 2, size };
    }
    case "drop": {
      const size = 64;
      return { x: (shape.width - size) / 2, y: top + 10, size };
    }
    case "permission": {
      const size = 76;
      return { x: 26, y: top + (body - size) / 2 - 8, size };
    }
    case "chat":
      return { x: PAD + 4, y: shape.height - PAD - CHAT_INPUT + (CHAT_INPUT - CHAT_BOT) / 2, size: CHAT_BOT };
  }
}

/** The open pill's bottom corners are rounder than the collapsed pill's. */
export function radiusOf(view: NotchView, geometry: NotchGeometry) {
  return view === "collapsed" ? Math.round(barOf(geometry) / 2.6) : 28;
}
