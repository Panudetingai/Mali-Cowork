/**
 * Team mode with a lead on a CLI agent (OpenCode, Codex, Cursor, Antigravity):
 * its loop isn't Mali's, so for the length of its run Mali's `mali` MCP
 * gateway offers it the team (`delegate_task`), and hides the connectors a
 * bot owns. The team's steps stream into the chat on a channel of their own.
 */
import { loadCommandSandbox } from "@/features/agent";
import { loadOpencodeSettings, type FolderGrantInput, type WorkMode } from "@/features/opencode";
import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { invoke } from "@tauri-apps/api/core";
import { runsOn, teamActive, teamPayload } from "./payload";

type LeadRun = { modelId: string; mode: WorkMode; cwd?: string; folders?: FolderGrantInput[]; runId: string };

/** Said to a CLI lead, which reads the team itself from the tool's description. */
export const CLI_LEAD_NOTE =
  "You lead the user's Mali team. Hand each job to the teammate whose duty it is with the `delegate_task` tool " +
  "(Mali's `mali` tools), and never do a teammate's work yourself — its connectors are its own. Then report to the user.";

/** Whether this run is a CLI lead's: team mode is on and the model runs on a CLI agent. */
export function isCliLead(modelId: string) {
  const kind = runsOn(modelId);
  return teamActive() && !!kind && kind !== "api";
}

/** Open the team to a CLI lead's run; true when it's open (close it with `endCliLead`). */
export async function beginCliLead(run: LeadRun, handlers: ChatStreamHandlers): Promise<boolean> {
  if (!isCliLead(run.modelId)) return false;
  const cowork = run.mode === "cowork";
  const payload = await teamPayload(run.mode, cowork ? run.cwd : undefined, cowork ? (run.folders ?? []) : []);
  if (!payload) return false;
  await invoke("team_lead_begin", {
    request: {
      prompt: "",
      provider: "",
      model: "",
      apiKey: null,
      baseUrl: null,
      instructions: null,
      effort: null,
      runId: run.runId,
      mode: run.mode,
      cwd: cowork ? (run.cwd ?? null) : null,
      folders: cowork ? (run.folders ?? []) : [],
      autoApprove: cowork && loadOpencodeSettings().autoApprove,
      sandbox: loadCommandSandbox(),
      mcp: [],
      images: [],
      vision: false,
      ...payload,
    },
    onEvent: createStreamChannel(handlers),
  });
  return true;
}

export function endCliLead(runId: string) {
  return invoke("team_lead_end", { runId }).catch(() => undefined);
}
