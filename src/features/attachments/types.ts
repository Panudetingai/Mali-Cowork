/** A file or picture attached to a prompt, copied into the app's own folder. */
export type Attachment = {
  id: string;
  name: string;
  /** Where the app keeps its copy. */
  path: string;
  mime: string;
  size: number;
  /** `image` / `video` are shown inline; `text` is pasted into the prompt; `file` is anything else. */
  kind: "image" | "video" | "text" | "file";
};
