import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { loadChatHistory } from "@/features/chat-history";
import { loadProjects } from "@/features/projects";
import { loadVault } from "@/features/secrets";
import { applyWindowChrome } from "@/lib/window-chrome";
import "./index.css";
import App from "./App";

void applyWindowChrome();

// Chats and projects come from SQLite, and keys from the keychain, before
// the first render, so nothing flashes as missing. A keychain prompt (dev
// builds) doesn't hold the window blank: syncs that need keys wait for it.
const keys = Promise.race([loadVault(), new Promise((resolve) => setTimeout(resolve, 1500))]);
void Promise.allSettled([loadChatHistory(), loadProjects(), keys]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
});
