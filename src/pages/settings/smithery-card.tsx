import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  connectSmithery,
  disconnectSmithery,
  setSmitheryEnabled,
  useSmithery,
  useSmitheryConnected,
} from "@/features/smithery";
import { SmitheryIcon } from "@/components/app/smithery-icon";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, LoaderCircleIcon, PlugZapIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Notice, SecretInput } from "./ui";

const KEYS_URL = "https://smithery.ai/account/api-keys";

/**
 * Connect Smithery, so its catalogue joins the results in Discover.
 *
 * The same card appears above both Discover lists — skills and connectors —
 * because one key covers both, and this is where someone is when they wish
 * there were more to choose from.
 *
 * The key is checked against Smithery before it is saved, and kept in the
 * system keychain with the app's other secrets.
 */
export function SmitheryCard({ what }: { what: "skills" | "connectors" }) {
  const state = useSmithery();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const connected = useSmitheryConnected();

  useEffect(() => {
    if (open) input.current?.focus();
    else {
      setKey("");
      setError(null);
    }
  }, [open]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await connectSmithery(key);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (connected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
        <SmitheryIcon size={28} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            Smithery
            <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
              <CheckIcon className="size-3" />
              Connected
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {state.enabled
              ? `Its ${what} appear in the results below.`
              : `Turned off — its ${what} are left out of the results.`}
          </p>
        </div>
        <Switch
          checked={state.enabled}
          onCheckedChange={setSmitheryEnabled}
          aria-label="Search Smithery"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={disconnectSmithery}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/80 bg-muted/15 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <SmitheryIcon size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Search Smithery too</p>
          <p className="text-xs text-muted-foreground">
            A larger catalogue of MCP servers and skills. Connect with your own account — it stays
            optional, and the sources below keep working either way.
          </p>
        </div>
        {!open && (
          <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => setOpen(true)}>
            <PlugZapIcon className="size-3.5" />
            Connect
          </Button>
        )}
        {open && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel"
            onClick={() => setOpen(false)}
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={connect} className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-xs text-muted-foreground">
            Paste an API key from{" "}
            <button
              type="button"
              onClick={() => void openUrl(KEYS_URL).catch(() => undefined)}
              className="font-medium text-foreground underline underline-offset-2"
            >
              your Smithery account
            </button>
            . It’s checked before it’s saved, and kept in your keychain.
          </label>
          <div className="flex gap-2">
            <SecretInput
              id={fieldId}
              ref={input}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="smithery-…"
              autoComplete="off"
              spellCheck={false}
              className="h-9"
            />
            <Button type="submit" size="sm" disabled={!key.trim() || busy} className="gap-1.5">
              {busy && <LoaderCircleIcon className="size-3.5 animate-spin" />}
              {busy ? "Checking…" : "Connect"}
            </Button>
          </div>
          {error && (
            <Notice tone="danger" onDismiss={() => setError(null)}>
              {error}
            </Notice>
          )}
        </form>
      )}
    </div>
  );
}


/** The badge that says a result came from Smithery rather than the usual place. */
export function SourceBadge({ source }: { source: "smithery" | "github" | "registry" }) {
  const label = source === "smithery" ? "Smithery" : source === "github" ? "GitHub" : "Registry";
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  );
}
