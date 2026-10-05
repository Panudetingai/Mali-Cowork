// Building blocks shared by every Settings tab, so they look like one system.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  SearchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { motion } from "motion/react";
import {
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/** A tab's title row: the same as `PageHeader`, for pages without a sub-page. */
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <PageHeader title={title} description={description} actions={actions} />;
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <SectionLabel>{children}</SectionLabel>;
}

export function SettingsSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("flex flex-col gap-4", className)}>{children}</section>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function IconTile({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-foreground [&_svg]:size-[1.125rem]",
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
        "inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {tone === "pending" && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
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
    <div className="relative min-w-0 w-full">
      <Input
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={cn("h-10 pr-10 text-sm", className)}
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
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold tracking-tight text-foreground">
        {label}
        {optional && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] leading-relaxed text-red-600 dark:text-red-400">{error}</p>
      ) : (
        hint && <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
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

/**
 * A titled section of a settings page. On a wide window its title and
 * description sit in a column on the left and the rows on the right, with a
 * hairline between sections — no boxes. `wide` puts the title on top and
 * gives the content the full width (lists of tiles).
 */
export function SettingsGroup({
  title,
  description,
  actions,
  footer,
  children,
  className,
  wide,
  danger,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small print under the rows. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  /** Destructive settings: the title reads red. */
  danger?: boolean;
  id?: string;
}) {
  const head = (title || description || actions) && (
    <div className={cn("flex min-w-0 flex-col gap-1.5", !wide && "xl:pt-3.5")}>
      <div className="flex items-start justify-between gap-3">
        {title && (
          <h3 className={cn("text-[15px] font-semibold tracking-tight", danger && "text-red-600 dark:text-red-400")}>{title}</h3>
        )}
        {actions && <div className={cn("flex shrink-0 items-center gap-1.5", !wide && "xl:hidden")}>{actions}</div>}
      </div>
      {description && <div className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</div>}
      {actions && !wide && <div className="hidden items-center gap-1.5 pt-1.5 xl:flex">{actions}</div>}
    </div>
  );
  return (
    <section
      id={id}
      className={cn(
        "grid scroll-mt-24 gap-x-12 gap-y-3 border-t border-border/60 py-7",
        !wide && "xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]",
        className,
      )}
    >
      {head || <span className="hidden xl:block" />}
      <div className="flex min-w-0 flex-col">
        {wide ? children : <div className="flex flex-col divide-y divide-border/60">{children}</div>}
        {footer && <p className="pt-3 text-xs leading-relaxed text-muted-foreground">{footer}</p>}
      </div>
    </section>
  );
}

/** A settings page: its header, then sections. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className="flex flex-col [&>header]:pb-7">{children}</div>;
}

/** One setting: what it is (and why) on the left, its control on the right. */
export function SettingRow({
  icon,
  label,
  description,
  control,
  children,
  htmlFor,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  /** Extra content under the row, full width. */
  children?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div className={cn("flex flex-col gap-3 py-3.5", className)}>
      <div className="flex min-h-8 flex-col gap-3 sm:flex-row sm:items-center">
        <Label htmlFor={htmlFor} className="flex min-w-0 flex-1 items-start gap-3">
          {icon && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground/70 [&_svg]:size-4">
              {icon}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{label}</span>
            {description && <span className="text-[13px] leading-relaxed text-muted-foreground">{description}</span>}
          </span>
        </Label>
        {control && <div className="flex shrink-0 items-center gap-2 sm:justify-end">{control}</div>}
      </div>
      {children}
    </div>
  );
}

/** A small segmented control (Light | Dark), like the system one. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T | undefined;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors [&_svg]:size-3.5",
              active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Numbered "how it works" steps, so a page says what to do first. */
export function Steps({ steps }: { steps: { title: ReactNode; description: ReactNode }[] }) {
  return (
    <ol className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold">
            {i + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{step.title}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{step.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Little "?" that explains a setting when people are lost.
 * Hover or tap shows a small card — use next to any label that needs
 * a plain-language "what is this / what do I do".
 */
export function HelpHint({ text, label }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button
        type="button"
        aria-label={typeof label === "string" ? label : "What is this?"}
        title={typeof label === "string" ? label : "What is this?"}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="flex size-5 items-center justify-center rounded-full border border-border bg-muted/60 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-6 left-1/2 z-50 w-56 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-left text-xs leading-relaxed font-normal text-popover-foreground normal-case shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ── Page kit: the Integrations look (pills, search, UPPERCASE sections,
// tiles) used by Models, Voice and Skills. Flat by default — the tile is the
// only box, and a setup with steps gets its own page instead of a dialog.

/** A page's title row; `icon` for a sub-page about one thing (a provider). */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  media,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  /** Shown as is in the icon's place (an icon picker brings its own frame). */
  media?: ReactNode;
  /** A sub-page: where Back goes. */
  back?: { label: string; onClick: () => void };
}) {
  return (
    <header className="flex flex-col gap-4">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="-ml-1 inline-flex w-fit items-center gap-0.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          {back.label}
        </button>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {media}
          {icon && (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card shadow-xs [&_img]:size-7 [&_svg]:size-7">
              {icon}
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">{title}</h2>
            {description && <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** "COLLABORATION": a small uppercase label over a group of tiles or rows. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</h3>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  );
}

/** Rounded filter pills (Collaboration · Development · CRM…). */
export function Pills<T extends string>({
  value,
  onChange,
  options,
  label,
  solid,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  label: string;
  /** Small square chips, the picked one filled dark (App Connections). */
  solid?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className="scroll-hidden -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border transition-colors",
              solid ? "h-7 rounded-md px-2.5 text-xs" : "h-8 rounded-full px-3.5 text-[13px]",
              on
                ? solid
                  ? "border-transparent bg-foreground font-medium text-background"
                  : "border-transparent bg-muted font-medium text-foreground"
                : "border-border/80 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={cn("text-[11px] tabular-nums", on ? (solid ? "text-background/70" : "text-muted-foreground") : "text-muted-foreground/70")}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  /** A search is running somewhere. */
  busy?: boolean;
}) {
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      {busy ? (
        <LoaderIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : (
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        className="h-9 rounded-lg bg-muted/40 pl-8 text-[13px] shadow-none"
      />
    </div>
  );
}

/** 1 → 2 → 3 columns of tiles. */
export function TileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>{children}</div>;
}

/** The black "NEW" tag next to a name; `free` reads green. */
export function TileBadge({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "free" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[10px] font-bold tracking-wide uppercase",
        tone === "dark" && "bg-foreground text-background",
        tone === "free" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** The small square button in a tile's corner ("+", a check, a chevron). */
export function TileButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  /** Done: filled instead of outlined. */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md border shadow-xs transition-colors [&_svg]:size-3.5",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The Integrations tile: logo top-left, a small action top-right, the name
 * and two lines of description, and a quiet status line at the bottom.
 */
export function Tile({
  icon,
  title,
  badge,
  description,
  meta,
  action,
  onOpen,
  openLabel,
  selected,
  radio,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
  /** Picked (a voice engine): outlined in the accent. */
  selected?: boolean;
  /** The tile is one choice of several. */
  radio?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground transition-[border-color,box-shadow]",
        selected
          ? "border-violet-500 ring-1 ring-violet-500 dark:border-violet-400 dark:ring-violet-400"
          : "border-border/70",
        onOpen && !selected && "hover:border-foreground/25 hover:shadow-[0_6px_16px_-8px_rgb(0_0_0/0.18)]",
        className,
      )}
    >
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          role={radio ? "radio" : undefined}
          aria-checked={radio ? !!selected : undefined}
          aria-label={openLabel ?? (typeof title === "string" ? title : undefined)}
          className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
      <div className="pointer-events-none flex items-start justify-between gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center [&_img]:size-7 [&_svg]:size-7">{icon}</span>
        {action && <div className="pointer-events-auto relative z-10 flex items-center gap-1.5">{action}</div>}
      </div>
      <div className="pointer-events-none flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-[14px] font-semibold tracking-tight">{title}</h3>
          {badge}
        </div>
        {description && <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {meta && (
        <div className="pointer-events-none mt-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{meta}</div>
      )}
    </div>
  );
}

/** A status dot and its words, for a tile's bottom line. */
export function Dot({ tone, children }: { tone: "success" | "warning" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 truncate",
        tone === "success" && "text-emerald-700 dark:text-emerald-400",
        tone === "warning" && "text-amber-700 dark:text-amber-400",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-muted-foreground/40",
        )}
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Rows without a box: hairlines between, label left, control right. */
export function FlatRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col divide-y divide-border/60 border-y border-border/60", className)}>
      {children}
    </div>
  );
}

/** One step of a setup page: a numbered rail on the left, the work on the right. */
export function Step({
  n,
  title,
  description,
  done,
  last,
  children,
}: {
  n: number;
  title: ReactNode;
  description?: ReactNode;
  done?: boolean;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
            done ? "bg-emerald-500 text-white" : "border border-border bg-background text-foreground",
          )}
        >
          {done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : n}
        </span>
        {!last && <span className="mt-2 w-px flex-1 bg-border/80" />}
      </div>
      <div className={cn("flex min-w-0 flex-col gap-3", !last && "pb-9")}>
        <div className="flex min-h-7 flex-col justify-center gap-0.5">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** A sub-page slides in, so moving deeper reads as moving forward. */
export function PageEnter({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
      transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex flex-col gap-8"
    >
      {children}
    </motion.div>
  );
}
