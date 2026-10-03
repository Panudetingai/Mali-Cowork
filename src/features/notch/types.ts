import type { BotChoice } from "@/features/cowork-bot";
import type { PermissionRequest, QuestionRequest, TodoItem } from "@/pages/chat/api/chat";

/**
 * What the pill is about: a live run, an approval, a run that just ended,
 * or nothing (notch mode keeps the pill up with nothing running).
 */
export type NotchPhase = "working" | "permission" | "done" | "idle";

/**
 * The pill's shape; the page sizes the window to it. `home` is the run (or a
 * greeting) and the team, `chat` asking in the notch, `question` the agent
 * asking the user to pick (or write) an answer, `drop` files dragged over it, `welcome` the first open after going into notch mode, `done` a
 * run that finished with something to see (it opens by itself).
 */
export type NotchView =
  | "collapsed"
  | "home"
  | "chat"
  | "permission"
  | "question"
  | "drop"
  | "welcome"
  | "done"
  | "sessions"
  | "recap"
  | "peek";

/**
 * A status the collapsed pill opens out for a moment to tell, then folds
 * back: a run finished or failed, a team bot took over or finished, a file
 * was written.
 */
export type NotchPeek = {
  /** Changes with each new peek, so the next one replaces this one. */
  id: string;
  tone: "done" | "failed" | "team" | "edit";
  title: string;
  detail?: string;
  /** Who it's about: the main spot shows this bot. */
  bot?: { key: string; mascot: BotChoice; name: string };
  edit?: NotchEdit;
};

/** One file a run wrote, as the notch shows it: a few lines of its diff. */
export type NotchEdit = {
  /** The step and the file: one per file a step changed. */
  id: string;
  path: string;
  kind: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  /** The first lines that changed (with a little context), clipped. */
  lines: { tag: "add" | "del" | "ctx"; text: string }[];
};

/** A chat the notch lists to pick up where it left off (`relay.ts` sends a handful). */
export type NotchSession = {
  id: string;
  title: string;
  /** The folder it works in (its name), for a Cowork chat. */
  folder?: string;
  /** The full path, to keep working there. */
  cwd?: string;
  mode: "chat" | "cowork" | "code";
  /** The model it last ran on. */
  model?: string;
  /** The user's last words in it, clipped. */
  asked?: string;
  /** The end of its last answer, clipped. */
  answer?: string;
  /** What it's doing now, while it runs. */
  step?: { kind: string; title: string };
  running: boolean;
  /** An approval is waiting in it. */
  waiting: boolean;
  /** Its last message was an error. */
  failed: boolean;
  updatedAt: number;
};

/** How much Cowork has done: today, and runs a day over the last week. */
export type NotchUsage = {
  runs: number;
  seconds: number;
  files: number;
  tokens: number;
  /** Dollars, where the provider says. */
  cost: number;
  /** Runs per day, the oldest first, today last (seven days). */
  days: number[];
};

/** A week of work (Monday to Sunday), in numbers: what the recap draws. */
export type NotchRecap = {
  /** Weeks back from this one (0 is this week). */
  week: number;
  /** The week's Monday (its start), and the next Monday. */
  from: number;
  to: number;
  /** Replies the agent finished, and the chats they were in. */
  tasks: number;
  chats: number;
  /** Files the tasks made, and the ones they changed (or removed). */
  created: number;
  edited: number;
  /** Commands it ran (Bash and the like). */
  commands: number;
  seconds: number;
  tokens: number;
  cost: number;
  /** Tasks per model, the most first. */
  models: { name: string; tasks: number }[];
  /** Tasks a day, Monday first. */
  days: number[];
};

/** Minutes a person would have spent, per thing the agent did: the time-saved estimate. */
export type NotchRates = { task: number; created: number; edited: number; command: number };

/** What the main window sends while Home or the session list is open. */
export type NotchOverview = { sessions: NotchSession[]; usage: NotchUsage; recap: NotchRecap };

/** How the open pill looks: the notch's black, frosted glass, or light. */
export type NotchLook = "black" | "glass" | "light";

/** A page, slide or picture the agent made, to preview in the notch. */
export type NotchShowcaseItem = {
  /** An https thumbnail, or a path on this computer when `local`. */
  image: string;
  local?: boolean;
  title?: string;
  /** Pixel size, so a page keeps its shape before it loads. */
  width?: number;
  height?: number;
};

/** What a run made in another app (a Canva design's pages) or on disk (pictures). */
export type NotchShowcase = {
  /** The app it lives in: `canva`, `notion`, `figma`, …; none for plain pictures. */
  source?: string;
  /** The connector whose tools made it, so the pill shows that connector's own icon. */
  connector?: string;
  title?: string;
  /** Opens it in its app. */
  url?: string;
  items: NotchShowcaseItem[];
};

/** A step the agent ran, newest last. */
export type NotchStep = { id: string; kind: string; title: string; done: boolean };

/** A team bot the lead handed work to in this reply. */
export type NotchMate = {
  id: string;
  name: string;
  mascot: BotChoice;
  color: string;
  /** What it is doing now, e.g. "Asking research"; its name before its first step. */
  status: string;
  done: boolean;
};

/** Who asks for an approval: a team bot, or the lead (the user's own bot) when unset. */
export type NotchAsker = { id: string; name: string; mascot: BotChoice };

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
  /** The agent's question, waiting for the user's pick (the run carries on once it's answered). */
  question?: QuestionRequest;
  /** The approval's command without the "Bot · " in front of a team bot's. */
  command?: string;
  asker?: NotchAsker;
  /** The answer so far (its end, when long): the notch shows a Cowork run's reply. */
  reply?: string;
  /** The folder a Cowork run works in. */
  folder?: string;
  /** Files the run changed (known once it ends; Undo is in the app). */
  changed?: number;
  /** What it made, to preview: taken out of the reply whole, however long the reply. */
  showcase?: NotchShowcase[];
  /** Set when this is the Cowork task the notch started (`notch:cowork`). */
  taskId?: string;
  /** Files the run wrote, newest last, with a few lines of each diff. */
  edits?: NotchEdit[];
  /** The run ended on an error: its first line. */
  failed?: string;
  /** When the run's prompt was sent, to show how long it has been at it. */
  startedAt?: number;
  /** Approvals and questions waiting across every run, this one included. */
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
  /**
   * Continue `chatId` as it is (a session picked in the notch): its own mode,
   * folder and model, unless `modelId` picks another.
   */
  session?: boolean;
};

/** Main → pill: the work started (or was queued), or why it didn't. */
export type NotchCoworkStarted = { id: string; taskId?: string; chatId?: string; error?: string };

/** Main → pill: first-run setup (system scan / downloads) while the app window is away. */
export type NotchSetup = {
  active: boolean;
  phase: "scan" | "install" | "done";
  title: string;
  detail?: string;
  /** 0–100 when known (e.g. install batch progress). */
  progress?: number;
};

/** Pill → main: the labels picked (or written) for each of a question's questions; none withdraws it. */
export type NotchAnswer = { chatId: string; id: string; answers: string[][] };

/** Pill → main: Allow (Y) or Deny (N) on an approval. */
export type NotchReply = { chatId: string; id: string; reply: "once" | "reject" };
