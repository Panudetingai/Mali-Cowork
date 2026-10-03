import { useMemo } from "react";

type Spark = { left: string; w: number; delay: number; dur: number };

const BASE: Spark[] = [
  { left: "6%", w: 3, delay: 0, dur: 2.4 },
  { left: "14%", w: 2, delay: 0.6, dur: 2.8 },
  { left: "22%", w: 4, delay: 1.1, dur: 2.2 },
  { left: "31%", w: 2, delay: 0.3, dur: 3.1 },
  { left: "40%", w: 3, delay: 1.8, dur: 2.5 },
  { left: "48%", w: 2, delay: 0.9, dur: 2.9 },
  { left: "56%", w: 4, delay: 1.4, dur: 2.3 },
  { left: "64%", w: 2, delay: 0.2, dur: 3.0 },
  { left: "72%", w: 3, delay: 1.6, dur: 2.6 },
  { left: "80%", w: 2, delay: 0.7, dur: 2.7 },
  { left: "88%", w: 3, delay: 1.2, dur: 2.4 },
  { left: "94%", w: 2, delay: 1.9, dur: 3.2 },
];

/** Rising sparks clipped to a width (0–100). */
export function sparksWithin(maxPercent: number, count = 12): Spark[] {
  const cap = Math.max(8, maxPercent);
  return BASE.slice(0, count).map((s, i) => ({
    ...s,
    left: `${Math.min(cap - 4, 6 + (i / Math.max(1, count - 1)) * (cap - 10))}%`,
  }));
}

export function EffortSparkLayer({
  sparks,
  variant = "prompt",
  className,
}: {
  sparks: Spark[];
  variant?: "prompt" | "track";
  className?: string;
}) {
  const list = useMemo(() => sparks, [sparks]);
  const anim = variant === "track" ? "effort-rise-track" : "effort-rise";
  return (
    <div className={className} aria-hidden>
      {list.map((spark, i) => (
        <span
          key={i}
          className={`${anim} absolute bottom-0 rounded-full bg-amber-300/90 shadow-[0_0_8px_rgba(251,191,36,0.75)] dark:bg-amber-200/85`}
          style={{
            left: spark.left,
            width: spark.w,
            height: spark.w,
            animationDelay: `${spark.delay}s`,
            animationDuration: `${spark.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

export function effortSparkSet(maxPercent = 100) {
  return sparksWithin(maxPercent);
}
