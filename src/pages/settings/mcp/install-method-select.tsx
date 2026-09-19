import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { InstallOption } from "@/features/mcp";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, CircleSlashIcon } from "lucide-react";
import { useState } from "react";

function hostOf(url?: string) {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

function optionMeta(option: InstallOption) {
  const host = option.kind === "remote" ? hostOf(option.build({}).url) : "";
  if (option.unsupported) {
    return {
      title: option.label,
      detail: option.kind === "remote" && host ? host : "Not available in Mali Cowork",
      blocked: true as const,
    };
  }
  if (option.kind === "remote") {
    return { title: option.label, detail: host || "Remote server", blocked: false as const };
  }
  if (option.needs === "docker") return { title: option.label, detail: "Container on this computer", blocked: false };
  if (option.needs) return { title: option.label, detail: `Runs via ${option.needs}`, blocked: false };
  return { title: option.label, detail: "Runs on this computer", blocked: false };
}

function OptionSummary({ option, className }: { option: InstallOption; className?: string }) {
  const { title, detail, blocked } = optionMeta(option);
  return (
    <span className={cn("flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left", className)}>
      <span className="truncate text-sm font-medium leading-tight">{title}</span>
      <span
        className={cn(
          "truncate text-xs leading-tight",
          blocked ? "text-amber-700/90 dark:text-amber-400/90" : "text-muted-foreground",
        )}
      >
        {detail}
      </span>
    </span>
  );
}

/** Popover list — works reliably inside modal dialogs (Radix Select often does not). */
export function InstallMethodSelect({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: InstallOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? options[0];

  if (!selected) return null;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="h-auto min-h-11 w-full justify-between gap-2 py-2.5 pl-3 pr-2.5 text-left font-normal shadow-sm"
        >
          <OptionSummary option={selected} />
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="z-[200] w-[var(--radix-popover-trigger-width)] gap-0 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul role="listbox" aria-label="Install method" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {options.map((option) => {
            const active = option.id === value;
            const { blocked } = optionMeta(option);
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={!!option.unsupported}
                  onClick={() => {
                    if (option.unsupported) return;
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    active && "bg-accent/70",
                    blocked && "cursor-not-allowed opacity-75 hover:bg-transparent",
                  )}
                >
                  {blocked ? (
                    <CircleSlashIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <span className="mt-1 size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <OptionSummary option={option} />
                    {blocked && option.unsupported && (
                      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                        {option.unsupported}
                      </span>
                    )}
                  </span>
                  {active && !blocked && (
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
