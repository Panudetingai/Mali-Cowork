import { Button } from "@/components/ui/button";
import {
  auditTime,
  getSandboxAudit,
  getSandboxStatus,
  type SandboxAuditRecord,
  type SandboxStatus,
} from "@/features/mcp";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, RefreshCwIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * What the sandbox is doing, in the one place MCP servers are managed: whether
 * local servers are launched through the runner, and what was refused lately.
 */
export default function SandboxCard() {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [events, setEvents] = useState<SandboxAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [next, audit] = await Promise.all([
      getSandboxStatus().catch(() => null),
      getSandboxAudit(20).catch(() => []),
    ]);
    setStatus(next);
    setEvents(audit);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Nothing to say while the backend is unreachable (e.g. the browser preview).
  if (!status && !loading) return null;

  const active = !!status?.runnerActive;
  const blocked = events.filter((e) => e.event);
  const Icon = active ? ShieldCheckIcon : ShieldAlertIcon;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border/70 p-3">
      <header className="flex items-center gap-2.5">
        <Icon className={cn("size-4 shrink-0", active ? "text-emerald-500" : "text-amber-500")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {active ? "Local MCP servers run sandboxed" : "MCP servers run unsandboxed"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {active
              ? "Each server starts through the runner: its own keys only, isolated working folder, whole process tree stopped together."
              : "The sandbox runner was not found next to the app, so servers start with the app's environment."}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {status?.policy && (
        <p className="text-xs text-muted-foreground">
          Network {status.policy.network.enabled ? "allowed" : "blocked"} · credentials{" "}
          {status.policy.credentials.default === "deny" ? "not shared" : status.policy.credentials.default} ·{" "}
          {blocked.length > 0 ? `${blocked.length} blocked in the log` : "nothing blocked lately"}
        </p>
      )}

      {events.length > 0 && (
        <>
          <button
            type="button"
            className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {open ? "Hide" : "Show"} the last {events.length} sandbox decisions
          </button>
          {open && (
            <ul className="flex flex-col gap-1.5">
              {events.map((entry, index) => (
                <li
                  key={`${entry.timestamp}-${index}`}
                  className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 font-medium",
                        entry.event ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
                      )}
                    >
                      {entry.action}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {entry.mcpId ?? entry.tool}
                      {entry.path ? ` · ${entry.path}` : ""}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{auditTime(entry.timestamp)}</span>
                  </div>
                  {entry.reason && <p className="text-muted-foreground">{entry.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
