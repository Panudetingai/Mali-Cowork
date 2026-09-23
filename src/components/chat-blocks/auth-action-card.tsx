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
import { CheckIcon, ExternalLinkIcon, KeyRound, LoaderIcon, LogInIcon, ShieldCheckIcon } from "lucide-react";
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
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = useMemo(() => {
    try {
      return new URL(action.url).host;
    } catch {
      return "";
    }
  }, [action.url]);
  // The button sits beside the title now, so its label has to be short: the
  // service is already named above it.
  const label = action.actionLabel?.trim() || "Sign in";

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      if (action.connectorId) {
        await signInConnector(action.connectorId);
      } else {
        await openUrl(action.url);
      }
      setDone(true);
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
        // A card, not loose text: this is the one thing in the reply the user
        // has to act on, and it was previously indistinguishable from prose.
        "overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <AuthServiceIcon action={action} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground" title={action.title}>
            {action.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {action.description ?? `${host || "This service"} needs your permission first.`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={busy || done}
          onClick={() => void run()}
        >
          {busy ? (
            <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
          ) : done ? (
            <CheckIcon className="size-3.5" aria-hidden />
          ) : action.connectorId ? (
            <LogInIcon className="size-3.5" aria-hidden />
          ) : (
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          )}
          {busy ? "Opening…" : done ? "Opened" : label}
        </Button>
      </div>

      {error ? (
        <p className="border-t border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : (
        // Where the tokens end up is the question people actually have about
        // a sign-in card, so it is answered on the card rather than nowhere.
        <p className="flex items-center gap-1.5 border-t bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <ShieldCheckIcon className="size-3 shrink-0 text-emerald-600 dark:text-emerald-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={action.url}>
            {done
              ? "Finish in your browser, then send your message again."
              : `Opens ${host || "the sign-in page"} in your browser — tokens stay on this device.`}
          </span>
        </p>
      )}
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
