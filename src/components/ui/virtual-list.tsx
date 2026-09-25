"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

type VirtualListProps<T> = {
  items: T[];
  itemHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onRangeChange?: (range: { start: number; end: number }) => void;
  className?: string;
};

export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 5,
  renderItem,
  onRangeChange,
  className,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 20 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const scrollTop = el.scrollTop;
      const clientHeight = el.clientHeight;
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
      const end = Math.min(
        items.length,
        Math.ceil((scrollTop + clientHeight) / itemHeight) + overscan,
      );
      setRange((prev) => {
        if (prev.start === start && prev.end === end) return prev;
        return { start, end };
      });
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [items.length, itemHeight, overscan]);

  useEffect(() => {
    onRangeChange?.(range);
  }, [range, onRangeChange]);

  const totalHeight = items.length * itemHeight;

  return (
    <div ref={containerRef} className={cn("relative overflow-auto", className)}>
      <div style={{ height: totalHeight, position: "relative" }}>
        {items.slice(range.start, range.end).map((item, index) => {
          const actualIndex = range.start + index;
          return (
            <div
              key={actualIndex}
              style={{
                position: "absolute",
                top: actualIndex * itemHeight,
                height: itemHeight,
                left: 0,
                right: 0,
              }}
            >
              {renderItem(item, actualIndex)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
