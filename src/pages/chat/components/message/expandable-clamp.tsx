"use client";

import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Tailwind max-height class when collapsed */
  maxHeightClass?: string;
  className?: string;
  disabled?: boolean;
};

/** Collapses tall message bodies with a show-more control. */
export function ExpandableClamp({
  children,
  maxHeightClass = "max-h-64",
  className,
  disabled,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (disabled || expanded) {
      setClamped(false);
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    setClamped(el.scrollHeight > el.clientHeight + 2);
  }, [children, disabled, expanded]);

  // The same tree whether or not it clamps: switching the wrapper would remount
  // the reply (and re-highlight its code) when the stream starts and ends.
  const clip = !disabled && !expanded;
  return (
    <div className={cn("min-w-0", className)}>
      <div ref={bodyRef} className={cn(clip && maxHeightClass, clip && "overflow-hidden")}>
        {children}
      </div>
      {!disabled && (clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
