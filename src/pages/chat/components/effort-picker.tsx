import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { describeEffort, type EffortLevel } from "@/features/effort";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { EffortSparkLayer, effortSparkSet } from "./effort-sparks";

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

  const hasLevels = levels.length >= 2;
  const index = hasLevels ? Math.max(0, levels.findIndex((level) => level.id === value)) : 0;
  const fill = hasLevels ? (index / (levels.length - 1)) * 100 : 0;
  const trackSparks = useMemo(() => effortSparkSet(Math.max(18, fill)), [fill]);

  if (!hasLevels) return null;

  const current = levels[index] ?? describeEffort(value);
  const atMax = index === levels.length - 1;

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
          className="shrink-0 gap-1 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          {current.label}
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[17.5rem] rounded-2xl border-border/60 p-3.5 shadow-lg"
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
        <div className="relative mt-3 mb-2 h-9">
          <div className="pointer-events-none absolute inset-x-3.5 top-1/2 -translate-y-1/2">
            <div className="relative h-5 overflow-hidden rounded-full bg-muted/80 ring-1 ring-border/40">
              <div
                className={cn(
                  "relative h-full overflow-hidden rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  atMax ? "bg-linear-to-r from-primary via-amber-500 to-violet-500" : "bg-primary",
                )}
                style={{ width: `${fill}%` }}
              >
                <EffortSparkLayer
                  sparks={trackSparks}
                  variant="track"
                  className="absolute inset-0 overflow-hidden opacity-90"
                />
              </div>
              {atMax && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-200/25 to-violet-300/20 dark:via-amber-400/15 dark:to-violet-400/10" />
              )}
            </div>
            {/* Stops, so the range is legible before anything is dragged. */}
            <div className="absolute inset-0 flex items-center justify-between px-1.5">
              {levels.map((level, at) => (
                <span
                  key={level.id}
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-300",
                    at <= index ? "bg-primary-foreground/80 shadow-[0_0_6px_rgba(255,255,255,0.5)]" : "bg-muted-foreground/35",
                    at === index && atMax && "bg-amber-100 shadow-[0_0_8px_rgba(251,191,36,0.9)]",
                  )}
                />
              ))}
            </div>
            <div
              className={cn(
                "absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background bg-foreground shadow-md transition-[left,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                atMax && "shadow-[0_0_0_3px_rgba(251,191,36,0.45),0_0_18px_rgba(167,139,250,0.35)]",
              )}
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

/** Soft lights rising through the prompt when thinking effort is at its max. */
export function EffortMaxGlow({ active }: { active: boolean }) {
  const sparks = useMemo(() => effortSparkSet(100), []);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-amber-400/15 via-violet-400/8 to-transparent dark:from-amber-300/20 dark:via-violet-300/10" />
      <EffortSparkLayer sparks={sparks} variant="prompt" className="absolute inset-0" />
    </div>
  );
}

/** Same spark language when the chat context is almost full. */
export function ContextNearMaxGlow({ ratio, active }: { ratio: number; active: boolean }) {
  const sparks = useMemo(() => effortSparkSet(Math.min(100, ratio * 100 + 8)), [ratio]);
  const full = ratio >= 0.95;
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden>
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent",
          full
            ? "from-red-400/12 via-amber-400/10 dark:from-red-400/18"
            : "from-amber-400/12 via-violet-400/6 dark:from-amber-300/14",
        )}
      />
      <EffortSparkLayer sparks={sparks} variant="prompt" className="absolute inset-0 opacity-80" />
    </div>
  );
}
