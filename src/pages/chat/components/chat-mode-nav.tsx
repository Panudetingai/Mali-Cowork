import { Button } from "@/components/ui/button";
import type { WorkMode } from "@/features/opencode";
import { cn } from "@/lib/utils";

const TABS: { mode: WorkMode; label: string }[] = [
  { mode: "chat", label: "Chat" },
  { mode: "cowork", label: "Cowork" },
];

type Props = {
  mode: WorkMode;
  onModeChange: (mode: WorkMode) => void;
};

export function ChatModeNav({ mode, onModeChange }: Props) {
  return (
    <nav className="flex items-center justify-center gap-5" aria-label="Work mode">
      {TABS.map((tab) => (
        <Button
          key={tab.mode}
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onModeChange(tab.mode)}
          aria-current={tab.mode === mode}
          className={cn(
            "transition-colors",
            tab.mode === mode ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
          )}
        >
          {tab.label}
        </Button>
      ))}
    </nav>
  );
}
