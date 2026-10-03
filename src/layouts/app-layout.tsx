import { CommandPalette } from "@/features/command-palette";
import { SidebarInset, SidebarProvider } from "@/components/animate-ui/components/radix/sidebar";
import { AppSidebar } from "@/components/app/sidebar/app-sidebar";
import { Titlebar } from "@/components/app/titlebar/titlebar";
import { RegistryInstallDialog } from "@/pages/settings/mcp/registry-install-dialog";
import { ErrorBoundary } from "@/components/app/error-boundary";
import { Outlet, useLocation } from "react-router-dom";
import { useScrollFade } from "@/components/ui/scroll-fade";
import { discardEphemeralChats } from "@/features/chat-history";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { MALI_EASE } from "@/lib/motion-presets";
import { motion } from "motion/react";
import { useEffect } from "react";

export function AppLayout() {
  // Leaving a page that failed gives the next one a clean start.
  const { pathname } = useLocation();
  // One key per section, so switching chats doesn't remount the chat page.
  const section = pathname.split("/")[1] || "chat";
  const fade = useScrollFade<HTMLDivElement>(section);
  const { t } = useTranslation();
  // A throwaway chat (the skill editor) goes once you navigate away from it.
  useEffect(() => discardEphemeralChats(pathname.match(/^\/chat\/([^/]+)/)?.[1]), [pathname]);
  return (
    <SidebarProvider className="flex h-svh min-h-0 w-full flex-col overflow-hidden bg-background">
      <Titlebar />
      <CommandPalette />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-mali-ambient opacity-90 dark:hidden"
          />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={fade.ref}
              onScroll={fade.onScroll}
              style={fade.style}
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto"
            >
              <ErrorBoundary resetKey={pathname} scope="page">
                {/* Enter-only fade: no exit wait (it could leave the next page
                    blank) and no scale/blur (it skews layout measurements of
                    animated children like the Settings tabs). */}
                <motion.div
                  key={section}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: MALI_EASE }}
                  // Bounded to the viewport: the chat page scrolls inside itself;
                  // taller pages overflow into the scroller above.
                  className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                  <Outlet />
                </motion.div>
              </ErrorBoundary>
            </div>
            {/* Scrollbars are hidden, so say "there is more" — and let a click get there. */}
            <button
              type="button"
              aria-label={t("scrollForMore")}
              tabIndex={fade.more ? 0 : -1}
              onClick={() => fade.ref.current?.scrollBy({ top: fade.ref.current.clientHeight * 0.8, behavior: "smooth" })}
              className={cn(
                "absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur transition-opacity duration-200 hover:text-foreground",
                fade.more ? "animate-bounce opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <ChevronDownIcon className="size-4" />
            </button>
          </div>
        </SidebarInset>
      </div>
      {/* Opened from Settings → Connectors and from install cards in chat. */}
      <RegistryInstallDialog />
    </SidebarProvider>
  );
}
