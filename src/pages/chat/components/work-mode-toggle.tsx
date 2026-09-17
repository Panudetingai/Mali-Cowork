import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/animate-ui/components/radix/toggle-group";
import type { WorkMode } from "@/features/opencode";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, SparklesIcon } from "lucide-react";

export type { WorkMode };

const MODES: { value: WorkMode; label: string; hint: string; icon: typeof MessageSquareIcon }[] = [
  { value: "chat", label: "Chat", hint: "Ask and talk — no file access", icon: MessageSquareIcon },
  { value: "cowork", label: "Cowork", hint: "Let the agent work in your folders", icon: SparklesIcon },
];

const LAST_MODE_KEY = "chat_work_mode";

export function loadWorkMode(): WorkMode {
  try {
    return localStorage.getItem(LAST_MODE_KEY) === "cowork" ? "cowork" : "chat";
  } catch {
    return "chat";
  }
}

export function saveWorkMode(mode: WorkMode) {
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
