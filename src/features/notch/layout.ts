/**
 * The pill's measurements, in logical pixels. The shape animates between
 * these inside the window; the window is sized to the shape plus room for
 * its shadow and the curved "ears" where it meets the top of the screen.
 *
 * Nothing is drawn where the camera is: the top row keeps clear of the notch
 * and a little either side of it, since the housing's corners curve. The
 * collapsed pill's step text drops to a row under the camera instead.
 */
import type { NotchGeometry, NotchPeek, NotchView } from "./types";

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
/** Under a notch the step text can't sit beside the camera: it gets a row below it. */
export const UNDER_NOTCH = 22;
/** Inset of the open pill's cards from its edges. */
export const PAD = 12;
/** Height of the open pill's body under the top row, per view. */
const BODY = { home: 168, welcome: 150, drop: 150, permission: 136, done: 200 } as const;
/** A peek: one line of news, or a file's first changed lines. */
const PEEK = { short: 84, edit: 150 } as const;
const PEEK_WIDTH = 560;
/** The session list: its header, and each row; past `SESSION_ROWS` it scrolls. */
export const SESSION_HEADER = 36;
export const SESSION_ROW = 64;
const SESSION_ROWS = 5;
/** The weekly recap: its header, the time saved, the tiles, the models, the note under them. */
export const RECAP = { header: 46, hero: 96, tiles: 70, model: 30, foot: 30, gap: 10 } as const;

/** Height of the chat's composer (the input, then its buttons), the file row above it, and the thread above that. */
export const CHAT_INPUT = 92;
/** Thumbnails of the attached files sit above the input. */
const CHAT_FILES = 60;
const CHAT_THREAD = 280;
/** The bot in the composer's corner. */
export const CHAT_BOT = 30;
/** Hint under the file row when send or attach fails (includes gap above the input). */
const CHAT_NOTE = 32;

export type Size = { width: number; height: number };
export type Frame = { x: number; y: number; size: number };
export type Box = { x: number; y: number; width: number; height: number };

/** What a view holds that changes its size: the chat's thread and files, a peek's kind, the list's length, the team. */
export type ChatFill = {
  thread?: boolean;
  files?: boolean;
  note?: boolean;
  peek?: NotchPeek["tone"];
  sessions?: number;
  /** Models the recap lists. */
  models?: number;
  /** Bots on the team, and whether Home shows them all. */
  team?: number;
  teamOpen?: boolean;
};

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
        height: barOf(geometry) + (geometry.hasNotch ? UNDER_NOTCH : 0),
      };
    case "chat": {
      const body =
        4 +
        CHAT_INPUT +
        (fill?.files ? CHAT_FILES : 0) +
        (fill?.thread ? CHAT_THREAD : 0) +
        (fill?.note ? CHAT_NOTE : 0) +
        PAD;
      return { width: openWidth(geometry, 640), height: top + body };
    }
    case "permission":
      return { width: openWidth(geometry, 600), height: top + BODY.permission };
    case "peek":
      return { width: openWidth(geometry, PEEK_WIDTH), height: top + (fill?.peek === "edit" ? PEEK.edit : PEEK.short) };
    case "recap": {
      const models = Math.min(Math.max(fill?.models ?? 1, 1), 4);
      const body =
        RECAP.header + RECAP.hero + RECAP.gap + RECAP.tiles + RECAP.gap + 20 + models * RECAP.model + RECAP.foot + PAD;
      return { width: openWidth(geometry, 640), height: top + body };
    }
    case "sessions": {
      const rows = Math.min(Math.max(fill?.sessions ?? 0, 1), SESSION_ROWS);
      return { width: openWidth(geometry, 640), height: top + SESSION_HEADER + rows * SESSION_ROW + PAD };
    }
    case "home":
      return {
        width: openWidth(geometry, 640),
        height: top + Math.max(BODY.home, teamHeight(fill?.team ?? 0, !!fill?.teamOpen) + PAD),
      };
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
  const shapes = [
    shapeSize("chat", geometry, { thread: true, files: true, note: true }),
    shapeSize("home", geometry, { team: TEAM_SHOWN, teamOpen: true }),
    shapeSize("sessions", geometry, { sessions: SESSION_ROWS }),
    shapeSize("recap", geometry, { models: 4 }),
    shapeSize("peek", geometry, { peek: "edit" }),
    ...(["welcome", "drop", "permission", "done"] as const).map((v) => shapeSize(v, geometry)),
  ];
  const widest = Math.max(...shapes.map((s) => s.width));
  const tallest = Math.max(...shapes.map((s) => s.height));
  return { width: widest + 2 * SHADOW, height: tallest + SHADOW };
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
export const TEAM_SHOWN = 6;
/** The team card's rows: its buttons, the lead, the team as a group, then a chip per bot. */
export const TEAM_HEADER = 30;
const LEAD_ROW = 36;
const GROUP_ROW = 46;
const CHIP = 34;
const GAP = 8;

/** The team card's height: the group alone, or open with its bots. */
function teamHeight(bots: number, open: boolean) {
  const shown = Math.min(bots, TEAM_SHOWN);
  const rows = open && shown ? Math.ceil(shown / 2) : 0;
  return TEAM_HEADER + 6 + LEAD_ROW + GAP + GROUP_ROW + (rows ? GAP + rows * CHIP + (rows - 1) * 6 : 0) + PAD;
}

/**
 * The team card: "Ask" and "New bot" along its top, the lead's chip, the
 * team as one row (its faces stacked, who's working), and when that's open,
 * a chip per bot in two columns.
 */
export function teamSlots(card: Box, bots: number, open: boolean) {
  const x = card.x + PAD;
  const width = card.width - 2 * PAD;
  const lead: Box = { x, y: card.y + TEAM_HEADER + 6, width, height: LEAD_ROW };
  const group: Box = { x, y: lead.y + LEAD_ROW + GAP, width, height: GROUP_ROW };
  const shown = open ? Math.min(bots, TEAM_SHOWN) : 0;
  const half = (width - 6) / 2;
  const chips: Box[] = Array.from({ length: shown }, (_, i) => ({
    x: x + (i % 2) * (half + 6),
    y: group.y + GROUP_ROW + GAP + Math.floor(i / 2) * (CHIP + 6),
    width: half,
    height: CHIP,
  }));
  return { lead, group, chips };
}

/** Where the main bot sits in the shape for each view. */
/** `slide`: Home's left card past its first page puts the bot small in its corner. */
export function mascotFrame(view: NotchView, geometry: NotchGeometry, shape: Size, slide = 0): Frame {
  const top = topRowOf(geometry);
  const body = shape.height - top;
  switch (view) {
    case "collapsed": {
      const bar = barOf(geometry);
      const size = Math.min(24, bar - 6);
      return { x: (WING - size) / 2 + 2, y: (bar - size) / 2, size };
    }
    case "home": {
      if (slide > 0) return { x: PAD + 12, y: top + 10, size: 24 };
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
    case "done": {
      const size = 72;
      return { x: PAD + 14, y: top + 12, size };
    }
    case "chat":
      // In the composer's top-left corner, beside the words.
      return { x: PAD + 12, y: shape.height - PAD - CHAT_INPUT + 10, size: CHAT_BOT };
    case "peek": {
      const size = 50;
      return { x: PAD + 20, y: top + (body - PAD - size) / 2, size };
    }
    case "recap":
      // At the start of the recap's header, beside its title.
      return { x: PAD + 6, y: top + (RECAP.header - 26) / 2, size: 26 };
    case "sessions":
      // At the start of the list's header, small.
      return { x: PAD + 8, y: top + (SESSION_HEADER - 22) / 2, size: 22 };
  }
}

/** The open pill's bottom corners are rounder than the collapsed pill's. */
export function radiusOf(view: NotchView, geometry: NotchGeometry) {
  return view === "collapsed" ? Math.round(barOf(geometry) / 2.6) : 28;
}
