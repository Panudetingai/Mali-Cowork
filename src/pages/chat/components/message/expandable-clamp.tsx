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

  if (disabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div
        ref={bodyRef}
        className={cn(!expanded && maxHeightClass, !expanded && "overflow-hidden")}
      >
        {children}
      </div>
      {(clamped || expanded) && (
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
