import { cn } from "@/lib/utils";

/**
 * A nav row. The white card behind the page you're on belongs to the list
 * (`ActiveIndicatorList`), so it glides from row to row.
 */
export const sidebarItemClass = cn(
  "group/nav relative flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-sidebar-foreground/75 outline-hidden ring-sidebar-ring transition-colors",
  "hover:text-sidebar-foreground focus-visible:ring-2 [&>svg]:relative [&>svg]:size-[18px] [&>svg]:shrink-0",
  "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:p-2!",
  "data-[active=true]:font-medium data-[active=true]:text-foreground",
);

/** A chat in the history: plain text, the open one lifted onto a card. */
export const chatRowClass = cn(
  "group/row relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-sidebar-foreground/75 outline-hidden ring-sidebar-ring transition-colors",
  "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2",
  "data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:hover:bg-transparent",
);

/** How the white card behind the active row looks. */
export const activeCardLook =
  "rounded-lg border border-sidebar-border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.06)] dark:bg-sidebar-accent";

/** That card filling a row (the row being renamed). */
export const activeBackdropClass = `absolute inset-0 ${activeCardLook}`;
