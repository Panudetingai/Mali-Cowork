export type AuthActionBlock = {
  title: string;
  description?: string;
  url: string;
  actionLabel?: string;
  /** When set, runs in-app MCP sign-in instead of opening the URL directly. */
  connectorId?: string;
  service?: string;
};

export type MediaPreviewBlock = {
  kind: "image" | "video" | "link";
  /** A web address, or a path on this computer when `local` is set. */
  url: string;
  /**
   * `url` is a file on this computer — a generated picture or clip. It is
   * read through the file API and shown from a blob, because a webview cannot
   * load `file://` from an app page.
   */
  local?: boolean;
  title?: string;
  description?: string;
  thumbnail?: string;
};
