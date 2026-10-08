import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { describeEffort, type EffortLevel } from "@/features/effort";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { EffortSparkLayer, effortSparkSet, sparksWithin } from "./effort-sparks";

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
  const trackSparks = useMemo(() => sparksWithin(100, 24), []);

  const hasLevels = levels.length >= 2;
  if (!hasLevels) return null;

  const index = Math.max(0, levels.findIndex((level) => level.id === value));
  const fill = (index / (levels.length - 1)) * 100;
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
        className="w-[17.5rem] gap-0 rounded-2xl border-border/60 p-3.5 shadow-lg"
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
            inside the popover at both ends. At the provider's top level the
            fill turns to a grey sweep with motes drifting up through it and a
            band of light passing along; below that, nothing moves. */}
        <div className="relative mt-4 mb-2 h-9">
          <div className="pointer-events-none absolute inset-x-3.5 top-1/2 -translate-y-1/2">
            <div className="relative h-5 overflow-hidden rounded-full bg-muted/80 ring-1 ring-border/40">
              <div
                className={cn(
                  "relative h-full overflow-hidden rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  atMax
                    ? "bg-linear-to-r from-neutral-950 via-neutral-700 to-neutral-500 dark:from-neutral-700 dark:via-neutral-500 dark:to-neutral-400"
                    : "bg-primary",
                )}
                style={{ width: `${fill}%` }}
              >
                {atMax && (
                  <>
                    <EffortSparkLayer sparks={trackSparks} variant="track" className="absolute inset-0" />
                    <div className="effort-sheen absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-white/20 to-transparent" />
                  </>
                )}
              </div>
            </div>
            {/* Stops, so the range is legible before anything is dragged. */}
            <div className="absolute inset-0 flex items-center justify-between px-1.5">
              {levels.map((level, at) => (
                <span
                  key={level.id}
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-300",
                    at > index
                      ? "bg-muted-foreground/35"
                      : atMax
                        ? "bg-white/70"
                        : "bg-primary-foreground/70",
                  )}
                />
              ))}
            </div>
            <div
              className={cn(
                "absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background bg-foreground shadow-md transition-[left,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                atMax && "shadow-[0_0_0_1px_var(--color-border),0_0_14px_rgba(0,0,0,0.18)] dark:shadow-[0_0_0_1px_var(--color-border),0_0_14px_rgba(255,255,255,0.2)]",
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
          <p className="mt-2.5 border-t pt-2.5 text-[11px] leading-snug text-muted-foreground">
            {current.hint}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Soft motes rising through the prompt when thinking effort is at its max. */
export function EffortMaxGlow({ active }: { active: boolean }) {
  const sparks = useMemo(() => effortSparkSet(100), []);
  if (!active) return null;
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="effort-breathe absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-foreground/[0.07] via-foreground/[0.02] to-transparent dark:from-white/[0.09] dark:via-white/[0.03]" />
      <div className="absolute inset-x-12 bottom-0 h-px bg-linear-to-r from-transparent via-foreground/25 to-transparent dark:via-white/40" />
      <EffortSparkLayer sparks={sparks} variant="prompt" className="absolute inset-x-0 bottom-0 h-full" />
    </motion.div>
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
