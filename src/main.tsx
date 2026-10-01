import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import { applyProductionHardening } from "@/lib/production-hardening";
import "@/features/i18n";
import "./index.css";

applyProductionHardening();

const root = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Every window runs this bundle, and each loads only its own code: the notch
// pill and the Quick bar stay small (they open instantly and sit in memory
// all day), while the app's pages load in the main window alone.
const windowParam = new URLSearchParams(window.location.search).get("window");

if (windowParam === "quick") {
  // The Quick bar (Epic A) skips the history/projects load: it opens on a
  // shortcut and must be instant. No main-window chrome here: its vibrancy
  // and system shadow drew a dark edge around the Quick bar, which draws
  // its own frame (index.css).
  document.documentElement.dataset.window = "quick";
  void import("@/features/quick").then(({ QuickBarRoot }) =>
    root().render(
      <React.StrictMode>
        <ThemeProvider>
          <QuickBarRoot />
        </ThemeProvider>
      </React.StrictMode>,
    ),
  );
} else if (windowParam === "notch") {
  // The pill mirrors the main window's runs; like the Quick bar it must open
  // instantly, so it loads no history and draws its own frame.
  document.documentElement.dataset.window = "notch";
  void import("@/features/notch/notch-root").then(({ NotchRoot }) =>
    root().render(
      <React.StrictMode>
        {/* The pill is part of the notch: always dark. */}
        <ThemeProvider forcedTheme="dark">
          <NotchRoot />
        </ThemeProvider>
      </React.StrictMode>,
    ),
  );
} else if (windowParam === "quick-capture-overlay") {
  document.documentElement.dataset.window = "quick-capture-overlay";
  void import("@/features/quick").then(({ QuickCaptureOverlay }) =>
    root().render(
      <React.StrictMode>
        <ThemeProvider>
          <QuickCaptureOverlay />
        </ThemeProvider>
      </React.StrictMode>,
    ),
  );
} else {
  void startMainWindow();
}

async function startMainWindow() {
  const [
    { BrowserRouter },
    { ErrorBoundary },
    { Toaster },
    { TooltipProvider },
    { loadChatHistory },
    { loadProjects },
    { applyQuickConfig },
    { loadVault },
    { applyWindowChrome },
    { checkMainAwake },
    { default: App },
  ] = await Promise.all([
    import("react-router-dom"),
    import("@/components/app/error-boundary"),
    import("@/components/ui/sonner"),
    import("@/components/ui/tooltip"),
    import("@/features/chat-history"),
    import("@/features/projects"),
    import("@/features/quick"),
    import("@/features/secrets"),
    import("@/lib/window-chrome"),
    import("@/features/notch"),
    import("./App"),
  ]);
  void applyWindowChrome();
  // Chats and projects come from SQLite, and keys from the keychain, before
  // the first render, so nothing flashes as missing. A keychain prompt (dev
  // builds) doesn't hold the window blank: syncs that need keys wait for it.
  const keys = Promise.race([
    loadVault(),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  // Hidden at the start (Mali started at login, in the notch): the pages wait.
  await Promise.allSettled([loadChatHistory(), loadProjects(), keys, checkMainAwake()]);
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
}
