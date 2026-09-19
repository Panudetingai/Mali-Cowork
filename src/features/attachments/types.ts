/** A file or picture attached to a prompt, copied into the app's own folder. */
export type Attachment = {
  id: string;
  name: string;
  /** Where the app keeps its copy. */
  path: string;
  mime: string;
  size: number;
  /** `image` is sent as a picture, `text` is pasted into the prompt, `file` is anything else. */
  kind: "image" | "text" | "file";
};
