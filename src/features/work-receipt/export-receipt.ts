import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChatSession } from "@/features/chat-history";
import { estimateMinutesSaved, DEFAULT_TIME_SAVED_RATES } from "./receipt";
import { getTimeSavedRates } from "./settings-store";
import type { WorkReceipt } from "./types";

function formatDate(ts?: number) {
  if (!ts) return new Date().toLocaleString();
  return new Date(ts).toLocaleString();
}

function formatDuration(ms?: number) {
  if (ms === undefined || ms === null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatMinutes(minutes: number) {
  if (minutes === 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function receiptToMarkdown(receipt: WorkReceipt, title: string): string {
  const lines: string[] = [];
  lines.push(`# Work Receipt: ${title}`);
  lines.push("");
  lines.push(`- Finished: ${formatDate(receipt.finishedAt)}`);
  lines.push(`- Model: ${receipt.modelId ?? "unknown"}`);
  lines.push(`- Duration: ${formatDuration(receipt.durationMs)}`);
  lines.push("");

  const { added, modified, deleted, additions, deletions } = receipt.files;
  lines.push(`## Files`);
  lines.push(`- Created: ${added}`);
  lines.push(`- Modified: ${modified}`);
  lines.push(`- Deleted: ${deleted}`);
  if (additions > 0 || deletions > 0) {
    lines.push(`- Diff: +${additions} / −${deletions} lines`);
  }
  if (receipt.files.changes.length > 0) {
    lines.push("");
    lines.push("### Changed files");
    for (const change of receipt.files.changes) {
      const sign = change.kind === "added" ? "+" : change.kind === "deleted" ? "−" : "~";
      const diff = change.additions || change.deletions ? ` (+${change.additions ?? 0}/−${change.deletions ?? 0})` : "";
      lines.push(`- ${sign} ${change.relative}${diff}`);
    }
  }
  lines.push("");

  if (receipt.commands.length > 0) {
    lines.push("## Commands");
    for (const command of receipt.commands) lines.push(`- ${command}`);
    lines.push("");
  }

  if (receipt.connectors.length > 0) {
    lines.push("## Connectors");
    for (const connector of receipt.connectors) {
      lines.push(`- ${connector.name} (${connector.serverId}): ${connector.calls} call(s)`);
    }
    lines.push("");
  }

  lines.push("## Usage");
  if (receipt.usage?.totalTokens !== undefined) lines.push(`- Tokens: ${receipt.usage.totalTokens.toLocaleString()}`);
  if (receipt.usage?.cost !== undefined) lines.push(`- Cost: $${receipt.usage.cost.toFixed(4)}`);
  lines.push(`- Steps: ${receipt.steps.total}${receipt.steps.failed > 0 ? ` (${receipt.steps.failed} failed)` : ""}`);
  lines.push("");

  const minutesSaved = estimateMinutesSaved(receipt, getTimeSavedRates() ?? DEFAULT_TIME_SAVED_RATES);
  lines.push(`## Time saved (estimate)`);
  lines.push(`- ${formatMinutes(minutesSaved)}`);
  lines.push("");

  if (receipt.partial) {
    lines.push(
      "> Some files were too large or private to snapshot, so this receipt may not cover everything.",
    );
    lines.push("");
  }

  if (receipt.state === "undone") {
    lines.push("> This turn was undone. The file changes above were reverted.",
    );
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export async function exportReceiptMarkdown(
  receipt: WorkReceipt,
  session: Pick<ChatSession, "title">,
): Promise<boolean> {
  const suggestedName = `${session.title.replace(/[^\w\-]/g, "_").slice(0, 40) || "receipt"}.md`;
  const path = await save({
    title: "Export work receipt as Markdown",
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;

  await writeTextFile(path, receiptToMarkdown(receipt, session.title));
  return true;
}
