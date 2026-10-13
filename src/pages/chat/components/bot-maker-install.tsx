/**
 * Installing what a bot needs without leaving the chat: a built-in connector
 * connects in place (its keys asked right here); a Registry connector or a
 * skill goes through the app's own install dialog, and whatever lands while
 * it was open is picked for the bot.
 */
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useChatInstallRequest, requestChatInstall } from "@/features/install-from-chat";
import { useInstructions } from "@/features/instructions";
import {
  missingEnv,
  requestConnectorInstall,
  useInstallRequest,
  useInstalledConnectors,
  type McpDef,
  type RegistryServer,
} from "@/features/mcp";
import { useMcpManager } from "@/pages/settings/mcp/use-mcp-manager";
import { SecretInput } from "@/pages/settings/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Picks up ids that appear in `ids` after `arm()`, while `busy` (an install
 * dialog is open) — or right after it closes. Returns what's being waited on.
 */
function useArrivals(ids: string[], busy: boolean, onArrive: (fresh: string[]) => void) {
  const before = useRef<Set<string> | null>(null);
  // Only a dialog that opened can be "closed without installing".
  const opened = useRef(false);
  const [waitingFor, setWaitingFor] = useState<string>();
  const key = ids.join("\n");
  useEffect(() => {
    if (!before.current) return;
    if (busy) opened.current = true;
    const fresh = ids.filter((id) => !before.current!.has(id));
    if (fresh.length) onArrive(fresh);
    if (fresh.length || (!busy && opened.current)) {
      before.current = null;
      opened.current = false;
      setWaitingFor(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, busy]);
  return {
    waitingFor,
    arm: (what: string) => {
      before.current = new Set(ids);
      opened.current = false;
      setWaitingFor(what);
    },
  };
}

/** Connectors: built-in ones connect here, Registry ones through the install dialog. */
export function useConnectorInstall(onInstalled: (ids: string[]) => void) {
  const mcp = useMcpManager();
  const installed = useInstalledConnectors();
  const request = useInstallRequest();
  const [setup, setSetup] = useState<string>();
  const [env, setEnv] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState<string>();
  const arrivals = useArrivals(
    installed.map((c) => c.id),
    !!request,
    onInstalled,
  );

  /** Connect a built-in one; the first press asks for its keys when it has any. */
  const connect = async (server: McpDef) => {
    const needsKeys = (server.envVars ?? []).length > 0;
    if (needsKeys && setup !== server.id) {
      setSetup(server.id);
      setEnv({});
      return;
    }
    if (missingEnv(server, { enabled: false, env }).length) {
      toast.error(`Fill in ${missingEnv(server, { enabled: false, env }).map((f) => f.label).join(", ")} first.`);
      return;
    }
    setConnecting(server.id);
    const ok = await mcp.apply(server.id, { enabled: true, ...(Object.keys(env).length ? { env } : {}) });
    setConnecting(undefined);
    if (!ok) return;
    setSetup(undefined);
    setEnv({});
    onInstalled([server.id]);
  };

  /** A connector that's added but off. */
  const turnOn = (id: string) => void mcp.apply(id, { enabled: true });

  const installFromRegistry = (server: RegistryServer) => {
    arrivals.arm(server.name);
    requestConnectorInstall({ server, fromChat: true });
  };

  return {
    connect,
    turnOn,
    installFromRegistry,
    setup,
    cancelSetup: () => setSetup(undefined),
    env,
    setEnv,
    connecting,
    /** The Registry server whose install dialog is open. */
    waitingFor: arrivals.waitingFor,
  };
}

/** Skills: installed from a link through the app's install dialog. */
export function useSkillInstall(onInstalled: (ids: string[]) => void) {
  const { skills } = useInstructions();
  const request = useChatInstallRequest();
  const arrivals = useArrivals(
    skills.map((k) => k.id),
    !!request,
    onInstalled,
  );
  return {
    install: (url: string) => {
      arrivals.arm(url);
      requestChatInstall({ kind: "skill", input: url });
    },
    /** The link whose install dialog is open. */
    waitingFor: arrivals.waitingFor,
  };
}

/** The keys a built-in connector needs, asked in place. */
export function EnvFields({
  server,
  env,
  onChange,
}: {
  server: McpDef;
  env: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {server.setup && <p className="text-xs leading-relaxed text-muted-foreground">{server.setup}</p>}
      {(server.envVars ?? []).map((f) => {
        const set = (value: string) => onChange({ ...env, [f.var]: value });
        return (
          <label key={f.var} className="flex flex-col gap-1 text-xs font-medium">
            <span>
              {f.label}
              {!f.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
            </span>
            {f.secret ? (
              <SecretInput value={env[f.var] ?? ""} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} className="h-8" />
            ) : (
              <Input value={env[f.var] ?? ""} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} className="h-8" />
            )}
          </label>
        );
      })}
      <p className="text-[11px] text-muted-foreground">Kept on this computer, the same as in Settings → Connectors.</p>
    </div>
  );
}
