import { Button } from "@/components/ui/button";
import type { ViewMode } from "./work-mode-toggle";
import { cn } from "@/lib/utils";
import { CodeXmlIcon, MessageSquareIcon, SparklesIcon } from "lucide-react";
import { motion } from "motion/react";

const TABS: { mode: ViewMode; label: string; icon: typeof MessageSquareIcon }[] = [
  { mode: "chat", label: "Chat", icon: MessageSquareIcon },
  { mode: "cowork", label: "Cowork", icon: SparklesIcon },
  { mode: "code", label: "Code", icon: CodeXmlIcon },
];

type Props = {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  className?: string;
  /** Icon-only (e.g. Code toolbar on medium widths). */
  iconsOnly?: boolean;
};

export function ChatModeNav({ mode, onModeChange, className, iconsOnly }: Props) {
  return (
    <nav className={cn("flex shrink-0 flex-nowrap items-center justify-center gap-5", className)} aria-label="Work mode">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Button
            key={tab.mode}
            type="button"
            variant="ghost"
            size="xs"
            title={tab.label}
            onClick={() => onModeChange(tab.mode)}
            aria-current={tab.mode === mode}
            aria-label={tab.label}
            className={cn(
              "relative gap-1.5 transition-colors",
              iconsOnly && "px-2",
              tab.mode === mode ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
            )}
          >
            {tab.mode === mode && (
              <motion.span
                layoutId="chat-view-mode"
                className="absolute inset-0 rounded-md bg-muted/90 ring-1 ring-border/50"
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className={iconsOnly ? "hidden xl:inline" : undefined}>{tab.label}</span>
            </span>
          </Button>
        );
      })}
    </nav>
  );
}
