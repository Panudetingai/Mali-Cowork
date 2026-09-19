import { Button } from "@/components/ui/button";
import type { McpDef } from "@/features/mcp";
import { CheckIcon, CopyIcon, ExternalLinkIcon, LockIcon } from "lucide-react";
import { useState } from "react";

export function McpMeta({ server }: { server: McpDef }) {
  const meta = server.registryName ?? server.id;
  if (!meta && !server.packageVersion && !server.repositoryUrl) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      {meta && <span className="font-mono">{meta}</span>}
      {server.packageVersion && (
        <>
          <span aria-hidden>·</span>
          <span>v{server.packageVersion}</span>
        </>
      )}
      {server.repositoryUrl && (
        <>
          <span aria-hidden>·</span>
          <a
            href={server.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline-offset-2 hover:underline"
          >
            Source
            <ExternalLinkIcon className="size-3" />
          </a>
        </>
      )}
    </p>
  );
}

export function EnvFieldHint({ field }: { field: { var: string; label: string; required?: boolean } }) {
  const hints: Record<string, string> = {
    GITHUB_PERSONAL_ACCESS_TOKEN:
      "Optional token for API access. Leave empty to sign in with OAuth on first use.",
  };
  const text = hints[field.var] ?? field.label;
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {text}{" "}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{field.var}</code>
    </p>
  );
}

export function KeychainNote() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <LockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
      Keys are stored on this device only and passed to the MCP server — never sent to the AI model.
    </p>
  );
}

export function RunOnDeviceBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  if (!command.trim()) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-foreground">Will run on this computer</p>
      <div className="relative rounded-xl border bg-muted/45 px-3 py-2.5">
        <pre className="max-h-32 overflow-auto pr-8 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-foreground/90">
          {command}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-2 right-2"
          aria-label={copied ? "Copied" : "Copy command"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // still visible
            }
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}

export function RemoteConnectionBlock({ url }: { url: string }) {
  if (!url.trim()) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-foreground">Remote (HTTP)</p>
      <div className="rounded-xl border bg-muted/45 px-3 py-2.5 font-mono text-[11px] break-all text-foreground/90">
        {url.trim()}
      </div>
    </div>
  );
}
