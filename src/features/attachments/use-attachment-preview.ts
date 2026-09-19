import { useEffect, useState } from "react";
import { readAttachmentBytes } from "./api";
import type { Attachment } from "./types";

/** A blob URL for an image attachment, or undefined while loading or for other kinds. */
export function useAttachmentPreview(attachment: Attachment) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (attachment.kind !== "image") return;
    let objectUrl: string | undefined;
    let cancelled = false;
    readAttachmentBytes(attachment)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
        setUrl(objectUrl);
      })
      .catch(() => setUrl(undefined));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);

  return url;
}
