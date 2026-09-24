import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { loadChatHistory } from "@/features/chat-history";
import { loadProjects } from "@/features/projects";
import { applyQuickConfig, QuickBarRoot } from "@/features/quick";
import { loadVault } from "@/features/secrets";
import { applyProductionHardening } from "@/lib/production-hardening";
import { applyWindowChrome } from "@/lib/window-chrome";
import { ThemeProvider } from "@/components/theme-provider";
import "./index.css";
import App from "./App";

void applyWindowChrome();
applyProductionHardening();

const root = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// The Quick bar (Epic A) is its own small window on the same bundle. It
// skips the history/projects load: it opens on a shortcut and must be instant.
if (new URLSearchParams(window.location.search).get("window") === "quick") {
  root().render(
    <React.StrictMode>
      <ThemeProvider>
        <QuickBarRoot />
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  startMainWindow();
}

function startMainWindow() {
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
          <ThemeProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ThemeProvider>
        </React.StrictMode>,
      );
    },
  );
}
