import type { CSSProperties } from "react";

type Spark = {
  /** Where it starts, 0–100 across the layer. */
  left: number;
  size: number;
  delay: number;
  dur: number;
  /** Sideways drift over the climb, in px. */
  drift: number;
  /** Where it starts up the layer, 0–1 (only the slider uses it). */
  y: number;
};

/** Fixed per index, so sparks don't jump about when the set is rebuilt. */
function noise(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Rising sparks spread across the first `maxPercent` of a layer (0–100). */
export function sparksWithin(maxPercent: number, count = 10): Spark[] {
  const cap = Math.min(100, Math.max(6, maxPercent));
  return Array.from({ length: count }, (_, i) => {
    const slot = (i + 0.2 + noise(i, 1) * 0.6) / count;
    return {
      left: 1 + slot * (cap - 2),
      size: 2 + Math.round(noise(i, 2) * 2),
      delay: noise(i, 3) * 3.5,
      dur: 2.6 + noise(i, 4) * 1.8,
      drift: (noise(i, 5) - 0.5) * 14,
      y: noise(i, 6),
    };
  });
}

export function effortSparkSet(maxPercent = 100) {
  return sparksWithin(maxPercent, 20);
}

/**
 * The sparks themselves. Pure CSS (transform and opacity only), so they run
 * on the compositor and cost next to nothing; see `.effort-spark` in index.css.
 */
export function EffortSparkLayer({
  sparks,
  variant = "prompt",
  className,
}: {
  sparks: Spark[];
  variant?: "prompt" | "track";
  className?: string;
}) {
  const track = variant === "track";
  return (
    <div className={className} aria-hidden>
      {sparks.map((spark, i) => (
        <span
          key={i}
          className={track ? "effort-spark effort-spark-fill" : "effort-spark"}
          style={
            {
              left: `${spark.left}%`,
              bottom: track ? `${spark.y * 60 - 30}%` : 0,
              width: track ? Math.max(1.5, spark.size - 1) : spark.size,
              height: track ? Math.max(1.5, spark.size - 1) : spark.size,
              animationDelay: `${spark.delay}s`,
              animationDuration: `${spark.dur}s`,
              "--drift": `${track ? spark.drift * 0.5 : spark.drift}px`,
              "--rise": track ? "18px" : "130px",
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
