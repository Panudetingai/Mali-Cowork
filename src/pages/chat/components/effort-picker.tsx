import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { describeEffort, type EffortLevel } from "@/features/effort";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";

/**
 * How hard the selected model should think, for models that let you choose.
 *
 * A slider rather than a menu because the levels are *ordered* — the question
 * is "how much", not "which one" — and a menu of seven words makes the user
 * read all seven to find out they are ranked. Shown only when the model offers
 * more than one level (see `efforts` on the model), so it is absent rather
 * than disabled for everything else.
 */
export function EffortPicker({
  levels,
  value,
  onChange,
  disabled,
}: {
  levels: EffortLevel[];
  value: string;
  onChange: (level: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sliderId = useId();

  if (levels.length < 2) return null;
  const index = Math.max(0, levels.findIndex((level) => level.id === value));
  const current = levels[index] ?? describeEffort(value);
  const fill = (index / (levels.length - 1)) * 100;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Thinking effort: ${current.label}`}
          title={current.hint ? `${current.label} — ${current.hint}` : current.label}
          className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          {current.label}
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-2xl p-3"
        onOpenAutoFocus={(event) => {
          // Land on the slider: arrow keys are the fastest way through this.
          event.preventDefault();
          document.getElementById(sliderId)?.focus();
        }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={sliderId} className="text-xs font-medium">
            Thinking effort
          </label>
          <span className="text-xs text-muted-foreground">{current.label}</span>
        </div>

        {/* The track, its fill and the thumb are real elements behind a
            transparent range input: the alternative is one rule per engine's
            slider pseudo-elements, and only Firefox has a "progress" part to
            colour. The track is inset by half a thumb so the thumb stays
            inside the popover at both ends. */}
        <div className="relative mt-3 mb-2 h-5">
          <div className="pointer-events-none absolute inset-x-2.5 top-1/2 -translate-y-1/2">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-100"
                style={{ width: `${fill}%` }}
              />
            </div>
            {/* Stops, so the range is legible before anything is dragged. */}
            <div className="absolute inset-0 flex items-center justify-between">
              {levels.map((level, at) => (
                <span
                  key={level.id}
                  className={cn(
                    "size-1 rounded-full",
                    at <= index ? "bg-primary-foreground/60" : "bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>
            <div
              className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow transition-[left] duration-100"
              style={{ left: `${fill}%` }}
            />
          </div>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={levels.length - 1}
            step={1}
            value={index}
            onChange={(event) => onChange(levels[Number(event.target.value)]!.id)}
            aria-label="Thinking effort"
            aria-valuetext={current.label}
            className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>

        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{levels[0]?.label}</span>
          <span>{levels[levels.length - 1]?.label}</span>
        </div>

        {current.hint && (
          <p className="mt-2 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
            {current.hint}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
