import { SidebarInset, SidebarProvider } from "@/components/animate-ui/components/radix/sidebar";
import { AppSidebar } from "@/components/app/sidebar/app-sidebar";
import { Titlebar } from "@/components/app/titlebar/titlebar";
import { RegistryInstallDialog } from "@/pages/settings/mcp/registry-install-dialog";
import { ErrorBoundary } from "@/components/app/error-boundary";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

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
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 1.02, filter: "blur(8px)" }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="min-h-0 min-w-0 flex-1"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </SidebarInset>
      </div>
      {/* Opened from Settings → Connectors and from install cards in chat. */}
      <RegistryInstallDialog />
    </SidebarProvider>
  );
}
