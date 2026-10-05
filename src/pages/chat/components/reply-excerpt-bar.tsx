import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { CornerDownRightIcon, XIcon } from "lucide-react";
import { excerptPreview } from "./reply-excerpt";

export function ReplyExcerptBar({
  excerpt,
  onClear,
  className,
}: {
  excerpt: string;
  onClear: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const preview = excerptPreview(excerpt);
  return (
    <div
      className={cn(
        "mb-2 flex items-start gap-2 border-b border-border/60 pb-2 pl-0.5 pr-1",
        className,
      )}
    >
      <CornerDownRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={excerpt}>
        <span className="text-muted-foreground/70">&ldquo;</span>
        {preview}
        <span className="text-muted-foreground/70">&rdquo;</span>
      </p>
      <button
        type="button"
        aria-label={t("selectionClearReply")}
        title={t("selectionClearReply")}
        onClick={onClear}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
