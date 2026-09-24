import { cn } from "@/lib/utils";
import {
  BracesIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileLockIcon,
  FileSpreadsheetIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  FolderOpenIcon,
  HashIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

type Kind = { icon?: LucideIcon; badge?: string; color: string };

// A short badge for the languages people spot by their initials, like editors do.
const BY_EXT: Record<string, Kind> = {
  ts: { badge: "TS", color: "text-sky-500" },
  mts: { badge: "TS", color: "text-sky-500" },
  cts: { badge: "TS", color: "text-sky-500" },
  tsx: { badge: "TSX", color: "text-sky-400" },
  js: { badge: "JS", color: "text-yellow-500" },
  mjs: { badge: "JS", color: "text-yellow-500" },
  cjs: { badge: "JS", color: "text-yellow-500" },
  jsx: { badge: "JSX", color: "text-yellow-400" },
  rs: { badge: "RS", color: "text-orange-500" },
  py: { badge: "PY", color: "text-blue-400" },
  go: { badge: "GO", color: "text-cyan-500" },
  java: { badge: "JV", color: "text-red-500" },
  kt: { badge: "KT", color: "text-violet-500" },
  swift: { badge: "SW", color: "text-orange-500" },
  rb: { badge: "RB", color: "text-red-500" },
  php: { badge: "PHP", color: "text-indigo-400" },
  c: { badge: "C", color: "text-blue-500" },
  h: { badge: "H", color: "text-blue-400" },
  cpp: { badge: "C++", color: "text-blue-500" },
  cs: { badge: "C#", color: "text-violet-500" },
  vue: { badge: "V", color: "text-emerald-500" },
  svelte: { badge: "S", color: "text-orange-600" },
  json: { icon: BracesIcon, color: "text-amber-500" },
  jsonc: { icon: BracesIcon, color: "text-amber-500" },
  yml: { icon: SettingsIcon, color: "text-rose-400" },
  yaml: { icon: SettingsIcon, color: "text-rose-400" },
  toml: { icon: SettingsIcon, color: "text-stone-400" },
  ini: { icon: SettingsIcon, color: "text-stone-400" },
  md: { icon: FileTextIcon, color: "text-sky-400" },
  mdx: { icon: FileTextIcon, color: "text-sky-400" },
  txt: { icon: FileTextIcon, color: "text-muted-foreground" },
  css: { icon: HashIcon, color: "text-blue-500" },
  scss: { icon: HashIcon, color: "text-pink-500" },
  less: { icon: HashIcon, color: "text-indigo-400" },
  html: { icon: FileCodeIcon, color: "text-orange-500" },
  htm: { icon: FileCodeIcon, color: "text-orange-500" },
  svg: { icon: FileImageIcon, color: "text-amber-400" },
  png: { icon: FileImageIcon, color: "text-purple-400" },
  jpg: { icon: FileImageIcon, color: "text-purple-400" },
  jpeg: { icon: FileImageIcon, color: "text-purple-400" },
  gif: { icon: FileImageIcon, color: "text-purple-400" },
  webp: { icon: FileImageIcon, color: "text-purple-400" },
  ico: { icon: FileImageIcon, color: "text-purple-400" },
  mp4: { icon: FileVideoIcon, color: "text-pink-400" },
  mov: { icon: FileVideoIcon, color: "text-pink-400" },
  mp3: { icon: FileAudioIcon, color: "text-pink-400" },
  wav: { icon: FileAudioIcon, color: "text-pink-400" },
  zip: { icon: FileArchiveIcon, color: "text-stone-400" },
  gz: { icon: FileArchiveIcon, color: "text-stone-400" },
  csv: { icon: FileSpreadsheetIcon, color: "text-emerald-500" },
  xlsx: { icon: FileSpreadsheetIcon, color: "text-emerald-500" },
  sh: { icon: FileTerminalIcon, color: "text-emerald-400" },
  bash: { icon: FileTerminalIcon, color: "text-emerald-400" },
  zsh: { icon: FileTerminalIcon, color: "text-emerald-400" },
  lock: { icon: FileLockIcon, color: "text-muted-foreground" },
  lockb: { icon: FileLockIcon, color: "text-muted-foreground" },
  sql: { icon: FileCodeIcon, color: "text-cyan-400" },
};

const BY_NAME: Record<string, Kind> = {
  "package.json": { icon: BracesIcon, color: "text-emerald-500" },
  "tsconfig.json": { badge: "TS", color: "text-sky-600" },
  "cargo.toml": { badge: "RS", color: "text-orange-600" },
  dockerfile: { icon: FileCodeIcon, color: "text-sky-500" },
  makefile: { icon: FileTerminalIcon, color: "text-orange-400" },
  ".gitignore": { icon: SettingsIcon, color: "text-orange-500" },
  license: { icon: FileTextIcon, color: "text-amber-500" },
};

function kindFor(name: string): Kind {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (/^readme(\.|$)/.test(lower)) return { icon: FileTextIcon, color: "text-sky-500" };
  if (/\.config\.[cm]?[jt]s$/.test(lower) || /^\.(eslintrc|prettierrc)/.test(lower)) {
    return { icon: SettingsIcon, color: "text-violet-400" };
  }
  if (lower.endsWith(".d.ts")) return { badge: "D", color: "text-sky-600" };
  if (lower.endsWith(".test.ts") || lower.endsWith(".spec.ts") || lower.endsWith(".test.tsx")) {
    return { badge: "T", color: "text-emerald-500" };
  }
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return BY_EXT[ext] ?? { icon: FileIcon, color: "text-muted-foreground/80" };
}

/** An icon (or language badge) for a file, colored by its type. */
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const kind = kindFor(name.split("/").pop() ?? name);
  if (kind.badge) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center font-mono text-[8.5px] leading-none font-bold tracking-tighter",
          kind.badge.length > 2 && "text-[7px]",
          kind.color,
          className,
        )}
      >
        {kind.badge}
      </span>
    );
  }
  const Icon = kind.icon ?? FileIcon;
  return <Icon aria-hidden className={cn("size-4 shrink-0", kind.color, className)} />;
}

export function FolderTypeIcon({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? FolderOpenIcon : FolderIcon;
  return <Icon aria-hidden className={cn("size-4 shrink-0 text-amber-500/80 dark:text-amber-400/80", className)} />;
}
