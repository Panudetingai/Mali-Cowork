"use client";

import { Button } from "@/components/ui/button";
import { updateChatMessages, useChatRuns, type ChatSession } from "@/features/chat-history";
import { restoreCheckpoint } from "@/features/checkpoints";
import { McpToolIcon } from "@/features/mcp/mcp-tool-icon";
import type { McpToolRef } from "@/features/mcp/tool-label";
import { cn } from "@/lib/utils";
import {
  CalculatorIcon,
  ChevronDownIcon,
  ClockIcon,
  CoinsIcon,
  DownloadIcon,
  FileMinusIcon,
  FilePenIcon,
  FilePlusIcon,
  LoaderIcon,
  ReceiptIcon,
  Redo2Icon,
  TerminalIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { exportReceiptMarkdown } from "./export-receipt";
import { estimateMinutesSaved } from "./receipt";
import { useTimeSavedRates } from "./settings-store";
import type { WorkReceipt } from "./types";

type Props = {
  receipt: WorkReceipt;
  session: Pick<ChatSession, "id" | "title">;
  className?: string;
};

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

function mcpRef(connector: WorkReceipt["connectors"][number]): McpToolRef {
  return {
    serverId: connector.serverId,
    serverName: connector.name,
    tool: "",
  };
}

export function WorkReceiptCard({ receipt, session, className }: Props) {
  const rates = useTimeSavedRates();
  const running = !!useChatRuns()[receipt.chatId];
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [note, setNote] = useState<string>();
  const [commandsOpen, setCommandsOpen] = useState(false);

  const undone = receipt.state === "undone";
  const minutesSaved = useMemo(
    () => estimateMinutesSaved(receipt, rates),
    [receipt, rates],
  );

  const nameOf = (path: string) => {
    const change = receipt.files.changes.find((c) => c.path === path);
    if (change) return change.relative;
    return path.split(/[\\/]/).pop() ?? path;
  };

  const restore = async (force = false) => {
    if (!receipt.checkpointId) return;
    const to = undone ? "after" : "before";
    setBusy(true);
    setNote(undefined);
    setConflicts([]);
    try {
      const result = await restoreCheckpoint(receipt.checkpointId, to, force);
      if (result.conflicts.length && !force) {
        setConflicts(result.conflicts);
        return;
      }
      updateChatMessages(receipt.chatId, (prev) =>
        prev.map((m) =>
          m.id === receipt.messageId && m.turn
            ? { ...m, turn: { ...m.turn, state: to === "before" ? "undone" : "applied" } }
            : m,
        ),
      );
      if (result.errors.length) {
        setNote(`Couldn't restore ${result.errors.length} file(s): ${result.errors[0]}`);
      } else if (result.skipped.length) {
        setNote(`${result.skipped.length} file(s) weren't saved, so they stayed as they are.`);
      }
    } catch (error) {
      setNote(String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      await exportReceiptMarkdown(receipt, session);
    } catch (error) {
      setNote(String(error));
    }
  };

  const canUndo = receipt.checkpointId && !running;

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-2xl border border-border/70 bg-muted/30",
        undone && "opacity-75",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3.5 py-2">
        <ReceiptIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Work receipt</span>
        {undone && (
          <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
            Undone
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={busy || running}
            onClick={() => void handleExport()}
          >
            <DownloadIcon className="size-3.5" />
            Export
          </Button>
          {canUndo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={busy}
              onClick={() => void restore()}
            >
              {busy ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : undone ? (
                <Redo2Icon className="size-3.5" />
              ) : (
                <Undo2Icon className="size-3.5" />
              )}
              {undone ? "Redo" : "Undo"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border/60 px-3.5 py-2 sm:grid-cols-6">
        <Stat icon={FilePlusIcon} tone="emerald" label="Created" value={receipt.files.added} />
        <Stat icon={FilePenIcon} tone="amber" label="Modified" value={receipt.files.modified} />
        <Stat icon={FileMinusIcon} tone="red" label="Deleted" value={receipt.files.deleted} />
        <Stat icon={ClockIcon} tone="neutral" label="Duration" value={formatDuration(receipt.durationMs)} />
        <Stat
          icon={CoinsIcon}
          tone="neutral"
          label="Cost"
          value={receipt.usage?.cost !== undefined ? `$${receipt.usage.cost.toFixed(3)}` : "—"}
        />
        <Stat
          icon={CalculatorIcon}
          tone="neutral"
          label="Saved"
          value={`~${formatMinutes(minutesSaved)}`}
          title="Estimated time saved (approximate)"
        />
      </div>

      {(receipt.files.additions > 0 || receipt.files.deletions > 0) && (
        <div className="border-t border-border/60 px-3.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="text-emerald-600 dark:text-emerald-400">+{receipt.files.additions}</span>
          {" / "}
          <span className="text-red-600 dark:text-red-400">−{receipt.files.deletions}</span>
          {" lines changed"}
        </div>
      )}

      {receipt.commands.length > 0 && (
        <div className="border-t border-border/60 px-3.5 py-1.5">
          <button
            type="button"
            onClick={() => setCommandsOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <TerminalIcon className="size-3.5" />
            <span className="flex-1 text-left">{receipt.commands.length} command(s)</span>
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", commandsOpen && "rotate-180")}
            />
          </button>
          {commandsOpen && (
            <ul className="mt-1.5 space-y-1 pl-5">
              {receipt.commands.map((command, index) => (
                <li
                  key={index}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  title={command}
                >
                  <code className="min-w-0 flex-1 truncate font-mono">{command}</code>
                  <CopyButton text={command} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {receipt.connectors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3.5 py-2">
          {receipt.connectors.map((connector) => (
            <span
              key={connector.serverId}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-[11px]"
              title={`${connector.name} (${connector.serverId})`}
            >
              <McpToolIcon mcp={mcpRef(connector)} size={12} />
              <span className="truncate max-w-[10rem]">{connector.name}</span>
              <span className="text-muted-foreground">×{connector.calls}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3.5 py-2 text-[11px] text-muted-foreground">
        {receipt.usage?.totalTokens !== undefined && (
          <span>Tokens: {receipt.usage.totalTokens.toLocaleString()}</span>
        )}
        {receipt.steps.total > 0 && (
          <span>
            Steps: {receipt.steps.total}
            {receipt.steps.failed > 0 && (
              <span className="ml-1 text-red-600 dark:text-red-400">({receipt.steps.failed} failed)</span>
            )}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1" title="Estimated time saved (approximate)">
          <CalculatorIcon className="size-3" />
          ~{formatMinutes(minutesSaved)} saved (estimate)
        </span>
      </div>

      {(note || receipt.partial || conflicts.length > 0) && (
        <div className="space-y-0.5 border-t border-border/60 px-3.5 py-2 text-[11px]">
          {note && <p className="text-red-600 dark:text-red-400">{note}</p>}
          {receipt.partial && (
            <p className="text-muted-foreground">
              Some files were too large or private to snapshot, so undo may not cover everything.
            </p>
          )}
          {conflicts.length > 0 && (
            <div className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>
                  {conflicts.length === 1 ? "This file was" : `${conflicts.length} files were`} changed after this
                  turn: <span className="font-medium">{conflicts.slice(0, 3).map(nameOf).join(", ")}</span>
                  {conflicts.length > 3 && ` and ${conflicts.length - 3} more`}. {undone ? "Redo" : "Undo"} anyway
                  replaces those changes too.
                </p>
                <div className="mt-1.5 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    disabled={busy}
                    onClick={() => void restore(true)}
                  >
                    {undone ? "Redo anyway" : "Undo anyway"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setConflicts([])}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "emerald" | "amber" | "red" | "neutral";
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "red"
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground";
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase">
        <Icon className={cn("size-3", toneClass)} />
        {label}
      </span>
      <span className="truncate text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy command"}
      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
    >
      {copied ? (
        <span className="text-[10px]">Copied</span>
      ) : (
        <span className="text-[10px]">Copy</span>
      )}
    </button>
  );
}
