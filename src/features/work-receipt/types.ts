/**
 * Epic C contract (docs/PRD-delight-v0.3.md §6.4): Work receipt, Outputs
 * gallery and Weekly recap. UI code depends on these shapes only; change
 * them here first, never inline in a component.
 */
import type { FileChange } from "@/features/checkpoints";
import type { AgentUsage } from "@/pages/chat/types";

/** What a finished Cowork turn did, shown under its last reply (C-FR1). */
export type WorkReceipt = {
  chatId: string;
  messageId: string;
  /** When the reply was written; missing on very old chats. */
  finishedAt?: number;
  modelId?: string;
  durationMs?: number;
  files: ReceiptFiles;
  /** Shell commands the agent ran, as the step titles show them. */
  commands: string[];
  /** MCP servers the turn called, most-used first. */
  connectors: ReceiptConnector[];
  steps: { total: number; failed: number };
  usage?: AgentUsage;
  /** Undo target; missing when the turn ran without a checkpoint. */
  checkpointId?: string;
  /** `undone` after Undo — the files are back as they were. */
  state: "applied" | "undone";
  /** Some files were too large or private to save, so they can't be undone. */
  partial: boolean;
};

export type ReceiptFiles = {
  /** New files; a renamed or moved file is not counted here. */
  added: number;
  /** Includes `renamed`: the file existed before, under another name. */
  modified: number;
  /** Removed files; the old name of a renamed file is not counted here. */
  deleted: number;
  /** Renamed or moved files (a delete + add pair with the same content size). */
  renamed: number;
  /** Lines, summed over text files only. */
  additions: number;
  deletions: number;
  changes: FileChange[];
};

export type ReceiptConnector = {
  /** e.g. `custom-notion`. */
  serverId: string;
  /** e.g. `Notion`. */
  name: string;
  calls: number;
};

/** Minutes a person would have spent, per unit of agent work (C-FR5). */
export type TimeSavedRates = {
  perFileCreated: number;
  perFileModified: number;
  perCommand: number;
  perConnectorCall: number;
};

export type OutputKind = "document" | "sheet" | "slides" | "pdf" | "image" | "code" | "other";

/** A file an agent created, as the Outputs gallery lists it (C-FR3). */
export type OutputItem = {
  /** Absolute path; also the item's key. */
  path: string;
  /** Path inside the granted folder, for display. */
  relative: string;
  name: string;
  kind: OutputKind;
  size?: number;
  createdAt: number;
  chatId: string;
  chatTitle: string;
  messageId: string;
  projectId?: string;
  checkpointId: string;
  /** The turn was undone, so the file was removed again. */
  undone: boolean;
};

export type OutputsQuery = {
  /** Only this project's chats. */
  projectId?: string;
  kinds?: OutputKind[];
  /** Case-insensitive match on the file name or relative path. */
  search?: string;
  /** Epoch ms, inclusive. */
  since?: number;
  /** Keep undone outputs in the list (off by default). */
  includeUndone?: boolean;
};

/** Whether an output is still where the agent left it (C.3). */
export type OutputStat = {
  path: string;
  exists: boolean;
  size?: number;
  modifiedAt?: number;
};

/** One week of agent work, computed on this device only (C-FR4). */
export type WeeklyRecap = {
  /** Monday 00:00 local time, epoch ms. */
  weekStart: number;
  /** The next Monday 00:00, exclusive. */
  weekEnd: number;
  /** Cowork turns that finished this week. */
  tasks: number;
  filesCreated: number;
  filesModified: number;
  commands: number;
  /** Time the agents spent working. */
  agentMs: number;
  totalTokens: number;
  cost: number;
  /** Estimate from `TimeSavedRates`; always label it as one in the UI. */
  minutesSaved: number;
  /** Most active first; `projectId` undefined = chats outside a project. */
  topProjects: { projectId?: string; tasks: number }[];
  topModels: { modelId: string; tasks: number }[];
};
