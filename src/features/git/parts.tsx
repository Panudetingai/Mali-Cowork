import { cn } from "@/lib/utils";

const UNITS: [Intl.RelativeTimeFormatUnit, number, string][] = [
  ["year", 365 * 24 * 3600, "y"],
  ["month", 30 * 24 * 3600, "mo"],
  ["week", 7 * 24 * 3600, "w"],
  ["day", 24 * 3600, "d"],
  ["hour", 3600, "h"],
  ["minute", 60, "m"],
];

/** "3 hours ago", or with `short` "3h ago", for a Unix time in seconds. */
export function timeAgo(seconds: number, short = false) {
  const diff = seconds - Date.now() / 1000;
  for (const [unit, size, abbr] of UNITS) {
    if (Math.abs(diff) < size) continue;
    const n = Math.round(diff / size);
    if (short) return `${Math.abs(n)}${abbr} ago`;
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(n, unit);
  }
  return "just now";
}

/** Branch/tag pills for `HEAD -> main`, `origin/main`, `tag: v1`. */
export function RefPill({ name }: { name: string }) {
  const isHead = name.startsWith("HEAD");
  const isTag = name.startsWith("tag: ");
  const label = name.replace(/^HEAD -> /, "").replace(/^tag: /, "");
  return (
    <span
      className={cn(
        "max-w-32 shrink-0 truncate rounded-full px-1.5 py-px text-[10px] font-medium",
        isHead
          ? "bg-primary/15 text-primary"
          : isTag
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      )}
      title={name}
    >
      {label}
    </span>
  );
}
