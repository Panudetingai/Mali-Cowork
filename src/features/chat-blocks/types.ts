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
  url: string;
  title?: string;
  description?: string;
  thumbnail?: string;
};
