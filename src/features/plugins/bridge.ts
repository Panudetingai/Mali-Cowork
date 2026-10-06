/**
 * What a plugin's panel may ask of the app.
 *
 * A panel runs in a sandboxed frame with no access to Mali: no commands, no
 * storage, no network. It sends `postMessage({ mali: 1, type, … })` to its
 * parent, and only these requests are answered:
 *
 * - `ready` → the app replies `init` with the theme, language and plugin
 * - `prompt` `{ text, mode? }` → opens a new chat with the text in the box
 *   (the user still presses send)
 * - `toast` `{ text }` → a short notice
 * - `copy` `{ text }` → copies to the clipboard
 * - `open` `{ url }` → opens an https link in the browser
 * - `storage.get` / `storage.set` `{ id, value? }` → the panel's own small
 *   store (256 KB), answered with `result` `{ id, value | error }`
 */
import { toast } from "@/components/ui/sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { InstalledPlugin } from "./store";

const MAX_TEXT = 20_000;
const MAX_STORAGE = 256 * 1024;

export type PanelMessage = { mali: 1; type: string; id?: string; [key: string]: unknown };

export type PanelHost = {
  plugin: InstalledPlugin;
  /** Send a message back into the panel. */
  reply: (message: Record<string, unknown>) => void;
  theme: () => "light" | "dark";
  locale: () => string;
  /** Start a new chat with `text` waiting in the box. */
  startChat: (text: string, mode: "chat" | "cowork") => void;
};

export function isPanelMessage(data: unknown): data is PanelMessage {
  return !!data && typeof data === "object" && (data as PanelMessage).mali === 1 && typeof (data as PanelMessage).type === "string";
}

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_TEXT) : "");

const storageKey = (pluginId: string) => `mali_plugin_data:${pluginId}`;

function readStorage(pluginId: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey(pluginId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Handle one message from a panel. Anything not listed above is ignored. */
export function handlePanelMessage(message: PanelMessage, host: PanelHost) {
  const { plugin, reply } = host;
  const result = (value: unknown, error?: string) =>
    message.id && reply({ mali: 1, type: "result", id: message.id, ...(error ? { error } : { value }) });

  switch (message.type) {
    case "ready":
      reply({
        mali: 1,
        type: "init",
        theme: host.theme(),
        locale: host.locale(),
        plugin: { id: plugin.id, name: plugin.name, version: plugin.version ?? null },
      });
      return;
    case "prompt": {
      const body = text(message.text).trim();
      if (body) host.startChat(body, message.mode === "chat" ? "chat" : "cowork");
      return;
    }
    case "toast": {
      const body = text(message.text).trim().slice(0, 300);
      if (body) toast(body, { description: `From ${plugin.name}` });
      return;
    }
    case "copy": {
      const body = text(message.text);
      if (body) void navigator.clipboard.writeText(body).then(() => toast.success("Copied"));
      return;
    }
    case "open": {
      const url = typeof message.url === "string" ? message.url : "";
      if (/^https:\/\/[^\s]+$/i.test(url)) void openUrl(url).catch(() => undefined);
      return;
    }
    case "storage.get":
      result(readStorage(plugin.id));
      return;
    case "storage.set": {
      let json: string;
      try {
        json = JSON.stringify(message.value ?? null);
      } catch {
        result(null, "The value can't be saved as JSON");
        return;
      }
      if (json.length > MAX_STORAGE) {
        result(null, "Too large: a panel keeps up to 256 KB");
        return;
      }
      try {
        localStorage.setItem(storageKey(plugin.id), json);
        result(true);
      } catch {
        result(null, "Storage is full");
      }
      return;
    }
  }
}

/** Forget what a plugin's panels stored, when the plugin goes. */
export function clearPanelStorage(pluginId: string) {
  try {
    localStorage.removeItem(storageKey(pluginId));
  } catch {
    // Nothing to clear.
  }
}
