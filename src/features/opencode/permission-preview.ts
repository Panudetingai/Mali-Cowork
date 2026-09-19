import type { PermissionRequest } from "@/pages/chat/api/chat";

/** Mock queue for tuning `PermissionPrompt` in dev (`VITE_PERMISSION_PREVIEW=1`). */
export const PERMISSION_PREVIEW_REQUESTS: PermissionRequest[] = [
  {
    id: "preview-run-command",
    directory: "/Users/demo/Mali-Cowork",
    permission: "bash",
    patterns: [],
    title: "Run command: npm run build",
    detail:
      "$ npm run build\n\n> mali-cowork@0.1.0 build\n> vite build && tauri build\n\nvite v6.x building for production…",
  },
  {
    id: "preview-external-dir",
    directory: "/Users/demo/Mali-Cowork",
    permission: "external_directory",
    patterns: ["/Users/demo/Downloads/*"],
    title: "Access directory: ~/Downloads",
    detail: null,
  },
];

export const PERMISSION_PREVIEW_ENABLED =
  import.meta.env.DEV &&
  (import.meta.env.VITE_PERMISSION_PREVIEW === "1" ||
    import.meta.env.VITE_PERMISSION_PREVIEW === "always");
