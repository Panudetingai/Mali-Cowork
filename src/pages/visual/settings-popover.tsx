import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DURATIONS,
  MAX_COUNT,
  RESOLUTIONS,
  SIZES,
  type ImageSettings,
  type Resolution,
  type SizePreset,
  type VideoSettings,
} from "@/features/visual";
import { cn } from "@/lib/utils";
import { ChevronUpIcon, ClockIcon, LayersIcon, RatioIcon, SparkleIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/** The little outline that shows a size's proportions on its button. */
function ShapeMark({ shape }: { shape: SizePreset["shape"] }) {
  return (
    <span
      aria-hidden
      className="block rounded-[3px] border-[1.5px] border-current"
      style={{ width: shape.w, height: shape.h }}
    />
  );
}

function Choice({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs transition-colors",
        active
          ? "bg-muted font-medium text-foreground ring-1 ring-border"
          : "text-muted-foreground hover:bg-muted/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * A slider with named stops, for counts and durations.
 *
 * The stops are not evenly spaced in value (2s, 5s, 10s, 20s, 30s), so the
 * slider moves through the *list* and the labels sit under their own stop —
 * dragging to "10s" lands on 10s rather than somewhere near it.
 */
function StopSlider({
  values,
  value,
  onChange,
  format = String,
  label,
}: {
  values: readonly number[];
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  label: string;
}) {
  const id = useId();
  const index = Math.max(0, values.indexOf(value));
  const fill = values.length > 1 ? (index / (values.length - 1)) * 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-5">
        <div className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${fill}%` }} />
          </div>
          <div
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
            style={{ left: `${fill}%` }}
          />
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={values.length - 1}
          step={1}
          value={index}
          onChange={(event) => onChange(values[Number(event.target.value)]!)}
          aria-label={label}
          aria-valuetext={format(value)}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent opacity-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
      <div className="flex justify-between px-1 text-[11px]">
        {values.map((stop) => (
          <span
            key={stop}
            className={cn(
              stop === value ? "font-medium text-foreground" : "text-muted-foreground/70",
            )}
          >
            {format(stop)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bar({ children, open }: { children: ReactNode; open: boolean }) {
  return (
    <PopoverTrigger asChild>
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs transition-colors",
          open ? "bg-muted" : "hover:bg-muted/60",
        )}
      >
        {children}
        <ChevronUpIcon
          className={cn("size-3.5 shrink-0 opacity-50 transition-transform", !open && "rotate-180")}
        />
      </button>
    </PopoverTrigger>
  );
}

const DIVIDER = <span aria-hidden className="h-3 w-px bg-border" />;

export function ImageSettingsBar({
  settings,
  onChange,
  maxCount = MAX_COUNT,
}: {
  settings: ImageSettings;
  onChange: (patch: Partial<ImageSettings>) => void;
  maxCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const size = SIZES.find((s) => s.id === settings.sizeId) ?? SIZES[0]!;
  const counts = Array.from({ length: maxCount }, (_, i) => i + 1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Bar open={open}>
        <span className="flex items-center gap-1.5 text-foreground">
          <RatioIcon className="size-3.5 shrink-0 opacity-70" />
          {size.label}
        </span>
        {DIVIDER}
        <span className="flex items-center gap-1.5 text-foreground">
          <LayersIcon className="size-3.5 shrink-0 opacity-70" />
          {settings.count} image{settings.count === 1 ? "" : "s"}
        </span>
      </Bar>
      <PopoverContent align="start" side="top" sideOffset={10} className="w-80 rounded-2xl p-4">
        <div className="flex flex-col gap-4">
          <Group label="Size">
            <div className="grid grid-cols-3 gap-1.5">
              {SIZES.map((preset) => (
                <Choice
                  key={preset.id}
                  active={preset.id === settings.sizeId}
                  onClick={() => onChange({ sizeId: preset.id })}
                >
                  <ShapeMark shape={preset.shape} />
                  {preset.label}
                </Choice>
              ))}
            </div>
          </Group>
          <Group label="Image count">
            <StopSlider
              values={counts}
              value={Math.min(settings.count, maxCount)}
              onChange={(count) => onChange({ count })}
              label="How many pictures to make"
            />
          </Group>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function VideoSettingsBar({
  settings,
  onChange,
}: {
  settings: VideoSettings;
  onChange: (patch: Partial<VideoSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  const size = SIZES.find((s) => s.id === settings.sizeId) ?? SIZES[0]!;
  const smart = settings.durationMode === "smart";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Bar open={open}>
        <span className="flex items-center gap-1.5 text-foreground">
          <SparkleIcon className="size-3.5 shrink-0 opacity-70" />
          {settings.resolution}
        </span>
        {DIVIDER}
        <span className="flex items-center gap-1.5 text-foreground">
          <RatioIcon className="size-3.5 shrink-0 opacity-70" />
          {size.label}
        </span>
        {DIVIDER}
        <span className="flex items-center gap-1.5 text-foreground">
          <ClockIcon className="size-3.5 shrink-0 opacity-70" />
          {smart ? "Auto" : `${settings.seconds}s`}
        </span>
      </Bar>
      <PopoverContent align="start" side="top" sideOffset={10} className="w-80 rounded-2xl p-4">
        <div className="flex flex-col gap-4">
          <Group label="Select resolution">
            <div className="grid grid-cols-3 gap-1.5">
              {RESOLUTIONS.map((value) => (
                <Choice
                  key={value}
                  active={value === settings.resolution}
                  onClick={() => onChange({ resolution: value as Resolution })}
                  className="py-2"
                >
                  {value}
                </Choice>
              ))}
            </div>
          </Group>
          <Group label="Select ratio">
            <div className="grid grid-cols-6 gap-1">
              {SIZES.map((preset) => (
                <Choice
                  key={preset.id}
                  active={preset.id === settings.sizeId}
                  onClick={() => onChange({ sizeId: preset.id })}
                  className="px-1 text-[10px]"
                >
                  <ShapeMark shape={preset.shape} />
                  {preset.label}
                </Choice>
              ))}
            </div>
          </Group>
          <Group label="Duration">
            <div className="grid grid-cols-2 gap-1.5">
              <Choice
                active={smart}
                onClick={() => onChange({ durationMode: "smart" })}
                className="py-2"
              >
                Let the model choose
              </Choice>
              <Choice
                active={!smart}
                onClick={() => onChange({ durationMode: "custom" })}
                className="py-2"
              >
                Choose a length
              </Choice>
            </div>
          </Group>
          {!smart && (
            <Group label="Select duration">
              <StopSlider
                values={DURATIONS}
                value={settings.seconds}
                onChange={(seconds) => onChange({ seconds })}
                format={(value) => `${value}s`}
                label="How long the clip should be"
              />
            </Group>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
