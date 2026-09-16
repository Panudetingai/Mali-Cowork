import { SidebarInset, SidebarProvider } from "@/components/animate-ui/components/radix/sidebar";
import { AppSidebar } from "@/components/app/sidebar/app-sidebar";
import { Titlebar } from "@/components/app/titlebar/titlebar";
import { Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <SidebarProvider className="flex h-svh min-h-0 w-full flex-col overflow-hidden bg-background">
      <Titlebar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
