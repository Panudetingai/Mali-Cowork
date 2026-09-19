import { cn } from "@/lib/utils";
import { FileIcon, FileTextIcon, XIcon } from "lucide-react";
import { formatSize } from "./api";
import type { Attachment } from "./types";
import { useAttachmentPreview } from "./use-attachment-preview";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  className?: string;
};

/** A thumbnail for a picture, or an icon with the name and size for any other file. */
export function AttachmentChip({ attachment, onRemove, className }: Props) {
  const preview = useAttachmentPreview(attachment);
  const Icon = attachment.kind === "text" ? FileTextIcon : FileIcon;

  return (
    <div
      title={`${attachment.name} · ${formatSize(attachment.size)}`}
      className={cn(
        "group/chip relative flex h-12 max-w-56 shrink-0 items-center gap-2 overflow-hidden rounded-lg border bg-muted/40",
        attachment.kind === "image" ? "w-12" : "pr-2.5",
        className,
      )}
    >
      {attachment.kind === "image" ? (
        preview ? (
          <img src={preview} alt={attachment.name} className="size-full object-cover" />
        ) : (
          <span className="size-full animate-pulse bg-muted" />
        )
      ) : (
        <>
          <span className="flex size-12 shrink-0 items-center justify-center border-r bg-background/60">
            <Icon className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{attachment.name}</span>
            <span className="block text-[10px] text-muted-foreground uppercase">
              {attachment.name.split(".").pop()} · {formatSize(attachment.size)}
            </span>
          </span>
        </>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${attachment.name}`}
          onClick={onRemove}
          className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-foreground/80 text-background opacity-0 transition-opacity group-hover/chip:opacity-100 focus-visible:opacity-100"
        >
          <XIcon className="size-2.5" />
        </button>
      )}
    </div>
  );
}
