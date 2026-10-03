import type { CoworkBotId } from "@/features/cowork-bot/store";
import type { BotLook } from "./look";

export type BotKnowledge = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
};

export type CustomBot = {
  id: string;
  name: string;
  /** Accent shown on cards and rings; base animation comes from `mascot`. */
  color: string;
  mascot: CoworkBotId;
  /** What it looks like, designed in the Studio; parts open as it levels up. */
  look: BotLook;
  role: string;
  /** How this bot prefers to work — grows with learned knowledge. */
  styleNotes: string;
  xp: number;
  /** Derived from `xp` when loading; stored for quick display. */
  level: number;
  workTurns: number;
  knowledge: BotKnowledge[];
  createdAt: number;
  updatedAt: number;
};

export type CustomBotDraft = Omit<CustomBot, "id" | "xp" | "level" | "workTurns" | "knowledge" | "look" | "createdAt" | "updatedAt"> &
  Partial<Pick<CustomBot, "id" | "xp" | "workTurns" | "knowledge" | "look">>;

export type BotExportBundle = {
  version: 1;
  exportedAt: number;
  bot: Omit<CustomBot, "id" | "createdAt">;
};
