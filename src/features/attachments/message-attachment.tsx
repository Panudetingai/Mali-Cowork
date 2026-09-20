import { cn } from "@/lib/utils";
import { FileIcon, FileTextIcon } from "lucide-react";
import { formatSize } from "./api";
import type { Attachment } from "./types";
import { useAttachmentPreview } from "./use-attachment-preview";

/** Rich inline preview for attachments inside a chat message. */
export function MessageAttachment({ attachment, className }: { attachment: Attachment; className?: string }) {
  const preview = useAttachmentPreview(attachment);

  if (attachment.kind === "image") {
    return (
      <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-muted/30", className)}>
        {preview ? (
          <img
            src={preview}
            alt={attachment.name}
            className="max-h-80 max-w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex h-40 w-56 animate-pulse items-center justify-center bg-muted" />
        )}
        <p className="truncate border-t border-border/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {attachment.name} · {formatSize(attachment.size)}
        </p>
      </div>
    );
  }

  if (attachment.kind === "video") {
    return (
      <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-muted/30", className)}>
        {preview ? (
          <video
            src={preview}
            controls
            playsInline
            preload="metadata"
            className="max-h-80 max-w-full bg-black"
          />
        ) : (
          <div className="flex h-40 w-72 animate-pulse items-center justify-center bg-muted text-xs text-muted-foreground">
            Loading video…
          </div>
        )}
        <p className="truncate border-t border-border/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {attachment.name} · {formatSize(attachment.size)}
        </p>
      </div>
    );
  }

  const Icon = attachment.kind === "text" ? FileTextIcon : FileIcon;
  return (
    <div
      className={cn(
        "flex max-w-sm items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/70">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">{formatSize(attachment.size)}</span>
      </span>
    </div>
  );
}
