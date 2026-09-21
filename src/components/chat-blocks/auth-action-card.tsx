"use client";

import { Button } from "@/components/ui/button";
import type { AuthActionBlock } from "@/features/chat-blocks";
import { lobeMcpIcon } from "@/features/mcp/lobe-icons";
import { getCustomMcps, useRegistryIcon, type McpToolRef } from "@/features/mcp";
import { signInConnector } from "@/features/mcp/connectors";
import { cn } from "@/lib/utils";
import type { IconType } from "@lobehub/icons/es/types";
import { Brave, Cloudflare, Figma, Github, Google, MCP, Microsoft, Notion, Vercel } from "@lobehub/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, KeyRound, LoaderIcon, LogInIcon, ShieldCheckIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

const ICON_TILE =
  "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-background";

function authHaystack(action: AuthActionBlock): string {
  let host = "";
  try {
    host = new URL(action.url).hostname.toLowerCase();
  } catch {
    // not a valid absolute url
  }
  return `${action.title} ${action.service ?? ""} ${action.url} ${host}`.toLowerCase();
}

function resolveAuthMcp(action: AuthActionBlock): McpToolRef | undefined {
  if (action.connectorId) {
    const custom = getCustomMcps().find((c) => c.id === action.connectorId);
    if (custom) {
      return { serverId: custom.id, serverName: custom.name, tool: "", custom };
    }
  }

  const hay = authHaystack(action);

  for (const custom of getCustomMcps()) {
    const name = custom.name.toLowerCase();
    if (name.length > 2 && hay.includes(name)) {
      return { serverId: custom.id, serverName: custom.name, tool: "", custom };
    }
    if (custom.url) {
      try {
        const host = new URL(custom.url).host.toLowerCase();
        if (host.length > 3 && hay.includes(host)) {
          return { serverId: custom.id, serverName: custom.name, tool: "", custom };
        }
      } catch {
        // ignore bad connector url
      }
    }
  }

  return undefined;
}

const BRAND_RULES: { test: RegExp; Icon: IconType }[] = [
  { test: /gmail|google|accounts\.google|youtube\.com/, Icon: Google },
  { test: /\bnotion\b|notion\.(so|com)/, Icon: Notion },
  { test: /microsoft|login\.live|outlook|office\.com|office365|azure/, Icon: Microsoft },
  { test: /\bgithub\b|github\.com/, Icon: Github },
  { test: /\bfigma\b|figma\.com/, Icon: Figma },
  { test: /\bvercel\b|vercel\.com/, Icon: Vercel },
  { test: /cloudflare/, Icon: Cloudflare },
  { test: /brave\.com|brave-search/, Icon: Brave },
];

function brandIcon(hay: string): IconType | null {
  for (const { test, Icon } of BRAND_RULES) {
    if (test.test(hay)) return Icon;
  }
  return null;
}

function DefaultAuthIcon() {
  return <KeyRound className="size-5 text-primary" strokeWidth={1.75} aria-hidden />;
}

/** Registry / brand marks like MCP steps; unknown services use a generic auth icon. */
function AuthServiceIcon({ action }: { action: AuthActionBlock }) {
  const mcp = useMemo(() => resolveAuthMcp(action), [action]);
  const hay = useMemo(() => authHaystack(action), [action]);
  const registrySrc = useRegistryIcon(mcp?.custom?.registry?.icons);

  let inner: ReactNode;

  if (registrySrc) {
    inner = (
      <img
        src={registrySrc}
        alt=""
        draggable={false}
        className="size-[22px] rounded-[3px] object-contain"
      />
    );
  } else {
    const Brand = brandIcon(hay);
    if (Brand) {
      inner = <Brand size={22} />;
    } else if (mcp) {
      const Lobe = lobeMcpIcon(mcp.serverId);
      inner = Lobe !== MCP ? <Lobe size={22} /> : <DefaultAuthIcon />;
    } else {
      inner = <DefaultAuthIcon />;
    }
  }

  return (
    <span className={ICON_TILE} aria-hidden>
      {inner}
    </span>
  );
}

export function AuthActionCard({
  action,
  className,
}: {
  action: AuthActionBlock;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = action.actionLabel ?? `Authorize ${action.service ?? action.title}`;

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      if (action.connectorId) {
        await signInConnector(action.connectorId);
      } else {
        await openUrl(action.url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-skip-markdown-delegate
      className={cn(
        "flex flex-col gap-3 rounded-xl",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AuthServiceIcon action={action} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <ShieldCheckIcon className="size-3.5 shrink-0 text-green-700" aria-hidden />
            {action.title}
          </p>
          {action.description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{action.description}</p>
          )}
          <p className="text-[11px] text-muted-foreground/80">
            Sign-in opens in your browser. Tokens stay on this device — not sent to the model.
          </p>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <Button
        type="button"
        className="gap-2"
        variant="outline"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? (
          <LoaderIcon className="size-4 animate-spin" aria-hidden />
        ) : action.connectorId ? (
          <LogInIcon className="size-4" aria-hidden />
        ) : (
          <ExternalLinkIcon className="size-4" aria-hidden />
        )}
        {busy ? "Opening…" : label}
      </Button>
    </div>
  );
}

export function AuthActionList({
  actions,
  className,
}: {
  actions: AuthActionBlock[];
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {actions.map((action) => (
        <AuthActionCard key={`${action.connectorId ?? action.url}-${action.title}`} action={action} />
      ))}
    </div>
  );
}
