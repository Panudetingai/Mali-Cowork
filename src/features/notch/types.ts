import type { CoworkBotId } from "@/features/cowork-bot";
import type { PermissionRequest, TodoItem } from "@/pages/chat/api/chat";

/**
 * What the pill is about: a live run, an approval, a run that just ended,
 * or nothing (notch mode keeps the pill up with nothing running).
 */
export type NotchPhase = "working" | "permission" | "done" | "idle";

/**
 * The pill's shape; the page sizes the window to it. `home` is the run (or a
 * greeting) and the team, `chat` asking in the notch, `drop` files dragged
 * over it, `welcome` the first open after going into notch mode.
 */
export type NotchView = "collapsed" | "home" | "chat" | "permission" | "drop" | "welcome";

/** A step the agent ran, newest last. */
export type NotchStep = { id: string; kind: string; title: string; done: boolean };

/** A team bot the lead handed work to in this reply. */
export type NotchMate = {
  id: string;
  name: string;
  mascot: CoworkBotId;
  color: string;
  /** What it is doing now, e.g. "Asking research"; its name before its first step. */
  status: string;
  done: boolean;
};

/** Who asks for an approval: a team bot, or the lead (the user's own bot) when unset. */
export type NotchAsker = { id: string; name: string; mascot: CoworkBotId };

/** One run, as the pill shows it. The main window builds it from its run store. */
export type NotchSnapshot = {
  phase: NotchPhase;
  chatId: string;
  title: string;
  /** The last few steps, newest last. */
  steps: NotchStep[];
  todos: TodoItem[];
  team: NotchMate[];
  /** The approval on screen when `phase` is "permission". */
  permission?: PermissionRequest;
  /** The approval's command without the "Bot · " in front of a team bot's. */
  command?: string;
  asker?: NotchAsker;
  /** The answer so far (its end, when long): the notch shows a Cowork run's reply. */
  reply?: string;
  /** The folder a Cowork run works in. */
  folder?: string;
  /** Files the run changed (known once it ends; Undo is in the app). */
  changed?: number;
  /** Set when this is the Cowork task the notch started (`notch:cowork`). */
  taskId?: string;
  /** Approvals waiting across every run, this one included. */
  waiting: number;
  /** Runs still going, this one included. */
  running: number;
};

/** The notch (or menu bar) the pill hangs from, in logical pixels (`notch.rs`). */
export type NotchGeometry = { hasNotch: boolean; notchWidth: number; barHeight: number };

/** Pill → main: work on this in a folder, like Cowork. */
export type NotchCoworkRequest = {
  /** Matches the answer (`NotchCoworkStarted`). */
  id: string;
  prompt: string;
  folder: string;
  modelId?: string;
  attachments: import("@/features/attachments").Attachment[];
  /** A follow-up: continue in this chat. */
  chatId?: string;
  /** Earlier in this conversation, for a follow-up that has to start a new chat. */
  context?: string;
};

/** Main → pill: the work started (or was queued), or why it didn't. */
export type NotchCoworkStarted = { id: string; taskId?: string; chatId?: string; error?: string };

/** Pill → main: Allow (Y) or Deny (N) on an approval. */
export type NotchReply = { chatId: string; id: string; reply: "once" | "reject" };
