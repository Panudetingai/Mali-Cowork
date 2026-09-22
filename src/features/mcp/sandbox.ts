import { invoke } from "@tauri-apps/api/core";

/**
 * What the app's own sandbox is doing right now. Local MCP servers are started
 * through `mali-mcp-runner`, which scopes their environment and holds the
 * process tree; the audit trail records what it refused.
 * Backend: src-tauri/src/sandbox
 */
export type SandboxStatus = {
  /** False when the runner binary is missing: servers then start unwrapped. */
  runnerActive: boolean;
  runnerPath?: string | null;
  policy: {
    network: { enabled: boolean };
    credentials: { default: string };
    toolPermissions: Record<string, string>;
  };
};

export type SandboxEventKind =
  | "sandboxViolation"
  | "permissionRequested"
  | "permissionDenied"
  | "sensitiveFileBlocked"
  | "networkBlocked"
  | "processBlocked"
  | "pathTraversalBlocked"
  | "commandBlocked"
  | "resourceLimitExceeded";

export type SandboxAuditRecord = {
  /** Seconds since the epoch, as the backend writes them. */
  timestamp: string;
  mcpId?: string | null;
  tool: string;
  action: string;
  decision: string;
  path?: string | null;
  reason?: string | null;
  event?: { kind: SandboxEventKind; tool: string; reason: string } | null;
};

export function getSandboxStatus() {
  return invoke<SandboxStatus>("get_sandbox_status");
}

export function getSandboxAudit(limit = 20) {
  return invoke<SandboxAuditRecord[]>("get_audit_logs", { limit });
}

/** `"1758...123Z"` → a local time the user can read, or "" when unparseable. */
export function auditTime(timestamp: string) {
  const seconds = Number.parseFloat(timestamp.replace(/Z$/, ""));
  if (!Number.isFinite(seconds)) return "";
  return new Date(seconds * 1000).toLocaleString();
}
