// Building blocks shared by every Settings tab, so they look like one system.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  PlusIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>
  );
}

/** Responsive card grid: 1 → 2 → 3 → 4 columns. */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export function IconTile({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background shadow-xs [&_svg]:size-5",
        className,
      )}
    >
      {children}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "neutral" | "pending";

const TONES: Record<Tone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  neutral: "border-border bg-background text-muted-foreground",
  pending: "border-border bg-muted text-muted-foreground",
};

export function StatusPill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-md border px-2 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {tone === "pending" && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
  );
}

/**
 * The card from the integrations grid: icon, name, two-line description and
 * a footer with status on the left and the main control on the right.
 */
export function IntegrationCard({
  icon,
  title,
  badge,
  description,
  status,
  control,
  onOpen,
  openLabel,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  description: ReactNode;
  status: ReactNode;
  control?: ReactNode;
  /** Clicking the card body opens its details. */
  onOpen?: () => void;
  openLabel?: string;
  highlight?: "success" | "danger";
}) {
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors",
        onOpen && "hover:border-foreground/20",
        highlight === "success" && "border-emerald-500/30",
        highlight === "danger" && "border-red-500/40",
      )}
    >
      {onOpen && (
        // Full-card hit area that stays keyboard accessible; controls sit above it.
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel ?? `Open ${title}`}
          className="absolute inset-0 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      )}
      <div className="pointer-events-none flex items-start justify-between gap-2">
        {icon}
        {badge}
      </div>
      <div className="pointer-events-none min-w-0 space-y-1">
        <h3 className="truncate text-[15px] font-semibold">{title}</h3>
        <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-auto flex min-h-8 items-center justify-between gap-2">
        <div className="pointer-events-none min-w-0">{status}</div>
        {control && <div className="relative z-10 shrink-0">{control}</div>}
      </div>
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
}: {
  tone?: "info" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const Icon = tone === "danger" ? XCircleIcon : tone === "warning" ? AlertTriangleIcon : InfoIcon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-xl border p-3 text-sm",
        tone === "info" && "bg-muted/40",
        tone === "warning" && "border-amber-500/30 bg-amber-500/5",
        tone === "danger" && "border-red-500/30 bg-red-500/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info" && "text-muted-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-red-600 dark:text-red-400",
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted-foreground [overflow-wrap:anywhere]">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
      {onDismiss && (
        <Button type="button" variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss">
          <XIcon />
        </Button>
      )}
    </div>
  );
}

export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("flex min-w-0 items-center gap-1 rounded-lg border bg-muted/50 py-1 pr-1 pl-2.5", className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={command}>
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy command"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard can be blocked; the command is still visible.
          }
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

/** Password-style input with a show/hide toggle. */
export function SecretInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={cn("pr-9", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide value" : "Show value"}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {show ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
      </button>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export type KeyValueRow = { key: string; value: string };

export function toRows(record: Record<string, string> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

export function toRecord(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.map((r) => [r.key.trim(), r.value] as const).filter(([k, v]) => k && v.trim()),
  );
}

/** Editable list of name → value pairs (env vars, HTTP headers). */
export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  invalidKey,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  invalidKey?: (key: string) => boolean;
}) {
  const update = (index: number, patch: Partial<KeyValueRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const onEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onChange([...rows, { key: "", value: "" }]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => {
        const bad = !!row.key.trim() && invalidKey?.(row.key.trim());
        return (
          <div key={index} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
            <Input
              value={row.key}
              onChange={(e) => update(index, { key: e.target.value })}
              placeholder={keyPlaceholder}
              aria-invalid={bad || undefined}
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
            <SecretInput
              value={row.value}
              onChange={(e) => update(index, { value: e.target.value })}
              onKeyDown={onEnter}
              placeholder={valuePlaceholder}
              className="h-8 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove row"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              className="text-muted-foreground hover:text-destructive"
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <PlusIcon className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
