import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "@/components/app/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadChatHistory } from "@/features/chat-history";
import { loadProjects } from "@/features/projects";
import { applyQuickConfig, QuickBarRoot, QuickCaptureOverlay } from "@/features/quick";
import { loadVault } from "@/features/secrets";
import { applyProductionHardening } from "@/lib/production-hardening";
import { applyWindowChrome } from "@/lib/window-chrome";
import { ThemeProvider } from "@/components/theme-provider";
import "@/features/i18n";
import "./index.css";
import App from "./App";

applyProductionHardening();

const root = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// The Quick bar (Epic A) is its own small window on the same bundle. It
// skips the history/projects load: it opens on a shortcut and must be instant.
const windowParam = new URLSearchParams(window.location.search).get("window");

if (windowParam === "quick") {
  // No main-window chrome here: its vibrancy and system shadow drew a dark
  // edge around the Quick bar, which draws its own frame (index.css).
  document.documentElement.dataset.window = "quick";
  root().render(
    <React.StrictMode>
      <ThemeProvider>
        <QuickBarRoot />
      </ThemeProvider>
    </React.StrictMode>,
  );
} else if (windowParam === "quick-capture-overlay") {
  document.documentElement.dataset.window = "quick-capture-overlay";
  root().render(
    <React.StrictMode>
      <ThemeProvider>
        <QuickCaptureOverlay />
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  startMainWindow();
}

function startMainWindow() {
  void applyWindowChrome();
  // Chats and projects come from SQLite, and keys from the keychain, before
  // the first render, so nothing flashes as missing. A keychain prompt (dev
  // builds) doesn't hold the window blank: syncs that need keys wait for it.
  const keys = Promise.race([
    loadVault(),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  void Promise.allSettled([loadChatHistory(), loadProjects(), keys]).then(
    () => {
      // Register the saved Quick bar shortcut and tray mode.
      void applyQuickConfig();
      root().render(
        <React.StrictMode>
          <ErrorBoundary scope="app">
            <ThemeProvider>
              {/* One provider for every tooltip: Radix's Tooltip throws without it. */}
              <TooltipProvider delayDuration={300}>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
                <Toaster />
              </TooltipProvider>
            </ThemeProvider>
          </ErrorBoundary>
        </React.StrictMode>,
      );
    },
  );
}
