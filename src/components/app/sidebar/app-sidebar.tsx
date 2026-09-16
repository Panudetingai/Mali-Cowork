import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/animate-ui/components/radix/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
    Calendar,
    FolderKanban,
    LayoutDashboard,
    ListTodo,
    Settings,
    Users,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Tasks", url: "/tasks", icon: ListTodo },
  { title: "Calendar", url: "/calendar", icon: Calendar },
] as const;

const secondaryNav = [
  { title: "Team", url: "/team", icon: Users },
  { title: "Settings", url: "/settings", icon: Settings },
] as const;

function NavItem({
  title,
  url,
  icon: Icon,
}: {
  title: string;
  url: string;
  icon: LucideIcon;
}) {
  const { pathname } = useLocation();
  const isActive =
    url === "/" ? pathname === "/" : pathname.startsWith(url);

  return (
    <SidebarMenuItem>
      <NavLink
        to={url}
        title={title}
        data-active={isActive}
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        className={cn(
          "flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate",
          isActive &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )}
      >
        <Icon />
        <span className="truncate group-data-[collapsible=icon]:hidden">
          {title}
        </span>
      </NavLink>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  return (
    <Sidebar
      collapsible="icon"
      className="top-(--titlebar-height) bottom-0 h-auto max-h-[calc(100svh-var(--titlebar-height))] border-r-0"
    >
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Input placeholder="Search Chat History" className="w-full" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/55">
            Main
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <NavItem key={item.url} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/55">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryNav.map((item) => (
                <NavItem key={item.url} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Demo user">
              <div className="flex size-6 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
                P
              </div>
              <span className="text-sidebar-foreground">Philips</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
