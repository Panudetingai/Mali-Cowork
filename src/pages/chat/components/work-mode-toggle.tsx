import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/animate-ui/components/radix/toggle-group";
import type { WorkMode } from "@/features/opencode";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, SparklesIcon } from "lucide-react";

export type { WorkMode };

/** What the page shows: a work mode, or Code (a Cowork chat beside an editor). */
export type ViewMode = WorkMode | "code";

const MODES: { value: WorkMode; label: string; hint: string; icon: typeof MessageSquareIcon }[] = [
  {
    value: "chat",
    label: "Chat",
    // Both halves matter: people assume "no file access" means no tools at
    // all, and stop using connectors in Chat for no reason.
    hint: "Answers only — no folders and nothing on this Mac. Connectors still work.",
    icon: MessageSquareIcon,
  },
  {
    value: "cowork",
    label: "Cowork",
    hint: "Works in the folders you grant — reads, edits and runs commands there",
    icon: SparklesIcon,
  },
];

const LAST_MODE_KEY = "chat_work_mode";

export function loadViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(LAST_MODE_KEY);
    return saved === "cowork" || saved === "code" ? saved : "chat";
  } catch {
    return "chat";
  }
}

export function saveWorkMode(mode: ViewMode) {
  try {
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    // Falls back to Chat next launch.
  }
}

type Props = {
  mode: WorkMode;
  onModeChange: (mode: WorkMode) => void;
  className?: string;
};

/** Chat ↔ Cowork switch (Animate UI toggle group in the prompt toolbar). */
export function WorkModeToggle({ mode, onModeChange, className }: Props) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={mode}
      className={cn("shrink-0 bg-muted/40", className)}
      onValueChange={(value) => {
        if (value) onModeChange(value as WorkMode);
      }}
      aria-label="Work mode"
    >
      {MODES.map(({ value, label, hint, icon: Icon }) => (
        <ToggleGroupItem key={value} value={value} title={hint} className="gap-1.5 px-2.5">
          <Icon className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
