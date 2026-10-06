import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { refreshAntigravity } from "@/features/antigravity";
import { refreshCursor } from "@/features/cursor";
import { refreshOpencode } from "@/features/opencode";
import { useCliAgentEnabled, type BuiltinCliAgentId } from "./settings";

/** On a CLI agent tile: include this agent in the picker and run startup checks. */
export function CliAgentEnableSwitch({
  id,
  className,
  onToggled,
}: {
  id: BuiltinCliAgentId | string;
  className?: string;
  onToggled?: (enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = useCliAgentEnabled(id);
  return (
    <label
      className={cn("flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <Switch
        size="sm"
        checked={enabled}
        onCheckedChange={(on) => {
          setEnabled(on);
          onToggled?.(on);
          if (id === "opencode") void refreshOpencode(true);
          else if (id === "cursor") void refreshCursor(true);
          else if (id === "antigravity") void refreshAntigravity(true);
        }}
        aria-label={enabled ? "Turn off this CLI agent" : "Turn on this CLI agent"}
      />
      <span>{enabled ? "On" : "Off"}</span>
    </label>
  );
}
