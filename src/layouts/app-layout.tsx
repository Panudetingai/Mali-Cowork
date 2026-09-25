import { SidebarInset, SidebarProvider } from "@/components/animate-ui/components/radix/sidebar";
import { AppSidebar } from "@/components/app/sidebar/app-sidebar";
import { Titlebar } from "@/components/app/titlebar/titlebar";
import { RegistryInstallDialog } from "@/pages/settings/mcp/registry-install-dialog";
import { ErrorBoundary } from "@/components/app/error-boundary";
import { Outlet, useLocation } from "react-router-dom";

export function AppLayout() {
  // Leaving a page that failed gives the next one a clean start.
  const { pathname } = useLocation();
  return (
    <SidebarProvider className="flex h-svh min-h-0 w-full flex-col overflow-hidden bg-background">
      <Titlebar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto">
            <ErrorBoundary resetKey={pathname} scope="page">
              <Outlet />
            </ErrorBoundary>
          </div>
        </SidebarInset>
      </div>
      {/* Opened from Settings → Connectors and from install cards in chat. */}
      <RegistryInstallDialog />
    </SidebarProvider>
  );
}
