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

/** One page, slide or picture in a gallery. */
export type GalleryItem = {
  /** Thumbnail, an https link. */
  image: string;
  title?: string;
  /** Opens this page itself, when the service has a link per page. */
  url?: string;
  /** Pixel size, so portrait and landscape keep their shape before loading. */
  width?: number;
  height?: number;
};

/**
 * What an agent made or found in another app, shown as a strip of previews:
 * a Canva deck's slides, Notion pages, Figma frames, a Google Slides deck.
 */
export type GalleryBlock = {
  /** The app it lives in: `canva`, `notion`, `figma`, `google-slides`, … */
  source?: string;
  /** The connector the agent used (`custom-canva`), for its icon and name. */
  connector?: string;
  title?: string;
  /** Opens the whole thing in its app. */
  url?: string;
  items: GalleryItem[];
};
