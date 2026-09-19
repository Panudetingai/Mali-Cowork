import { Button } from "@/components/ui/button";
import type { OAuthLimit } from "@/features/mcp/oauth-limits";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, InfoIcon } from "lucide-react";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

export function OAuthLimitBanner({
  limit,
  className,
  onUseAlternative,
}: {
  limit: OAuthLimit;
  className?: string;
  /** e.g. switch custom MCP URL to the vendor’s local server. */
  onUseAlternative?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium leading-snug">
            {limit.service} limits sign-in to approved apps
          </p>
          {!open && limit.alternative && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Use <span className="font-medium text-foreground/90">{limit.alternative.label}</span>{" "}
                in Mali Cowork.
              </p>
              {onUseAlternative && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="relative z-10 h-7 text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onUseAlternative();
                  }}
                >
                  Switch
                </Button>
              )}
            </div>
          )}
          {open && (
            <div className="space-y-2 pt-0.5 text-xs leading-relaxed text-muted-foreground">
              <p>{limit.reason}</p>
              {limit.alternative && (
                <p>
                  <span className="font-medium text-foreground/90">What works: </span>
                  {limit.alternative.setup}
                </p>
              )}
              {limit.docsUrl && (
                <button
                  type="button"
                  onClick={() => void openUrl(limit.docsUrl!)}
                  className="font-medium text-foreground/85 underline-offset-2 hover:underline"
                >
                  Read the setup guide
                </button>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="relative z-10 h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {open ? "Hide" : "Why?"}
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
          />
        </Button>
      </div>
    </div>
  );
}
