"use client";

import { cn } from "@/lib/utils";
import { useEffect, type ReactNode } from "react";

/**
 * The floating list above the composer shared by `/` and `@`: compact rows,
 * with the highlighted row's detail in a panel beside it.
 */
export function PickerShell({
  label,
  idPrefix,
  active,
  detail,
  footer,
  className,
  children,
}: {
  label: string;
  idPrefix: string;
  active: number;
  /** Shown to the right of the list for the highlighted row. */
  detail?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.getElementById(`${idPrefix}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, idPrefix]);

  return (
    <div className={cn("absolute bottom-full left-0 z-20 mb-2 flex items-start gap-2", className)}>
      <div
        role="listbox"
        aria-label={label}
        className="w-72 overflow-hidden rounded-2xl border bg-popover p-1 text-popover-foreground shadow-xl animate-in fade-in-0 slide-in-from-bottom-1 duration-100"
      >
        <ul className="max-h-72 overflow-y-auto overscroll-contain">{children}</ul>
        {footer && <div className="border-t px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">{footer}</div>}
      </div>
      {detail && (
        <div className="hidden max-w-80 self-center rounded-lg bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-lg sm:block">
          {detail}
        </div>
      )}
    </div>
  );
}

export function PickerRow({
  id,
  active,
  onHover,
  onPick,
  icon,
  children,
  trailing,
}: {
  id: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li>
      <button
        id={id}
        type="button"
        role="option"
        aria-selected={active}
        onMouseDown={(e) => {
          // Pick before the textarea loses focus.
          e.preventDefault();
          onPick();
        }}
        onMouseEnter={onHover}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
          active ? "bg-accent text-accent-foreground" : "text-foreground",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">{children}</span>
        {trailing}
      </button>
    </li>
  );
}
