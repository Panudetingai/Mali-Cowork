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
// pill stays small (it opens instantly and sits in memory all day), while
// the app's pages load in the main window alone.
const windowParam = new URLSearchParams(window.location.search).get("window");

if (windowParam === "notch") {
  // The pill mirrors the main window's runs; it must open instantly, so it
  // loads no history and draws its own frame.
  document.documentElement.dataset.window = "notch";
  void Promise.all([import("@/features/notch/notch-root"), import("@/components/ui/sonner")]).then(
    ([{ NotchRoot }, { Toaster }]) =>
      root().render(
        <React.StrictMode>
          {/* The pill is part of the notch: always dark. */}
          <ThemeProvider forcedTheme="dark">
            <NotchRoot />
            <Toaster />
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

let mainMounted = false;

async function startMainWindow() {
  const { invoke, isTauri } = await import("@tauri-apps/api/core");
  const defer =
    isTauri() && (await invoke<boolean>("main_defer_boot").catch(() => false));

  if (defer && !mainMounted) {
    document.documentElement.dataset.mainDeferred = "1";
    const { checkMainAwake, onMainAwake } = await import("@/features/notch/notch-mode");
    await checkMainAwake();
    onMainAwake((awake) => {
      if (awake) void mountFullMain();
    });
    return;
  }

  await mountFullMain();
}

async function mountFullMain() {
  if (mainMounted) return;
  mainMounted = true;
  delete document.documentElement.dataset.mainDeferred;

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
  const keys = Promise.race([
    loadVault(),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  await Promise.allSettled([loadChatHistory(), loadProjects(), keys, checkMainAwake()]);
  void applyQuickConfig();
  root().render(
    <React.StrictMode>
      <ErrorBoundary scope="app">
        <ThemeProvider>
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
