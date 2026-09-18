import { cn } from "@/lib/utils";

export const sidebarItemClass = cn(
  "flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 text-left text-[13px] text-sidebar-foreground/80 outline-hidden ring-sidebar-ring transition-colors",
  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
  "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!",
  "data-[active=true]:bg-background data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:shadow-xs dark:data-[active=true]:bg-sidebar-accent",
);
