import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { iconFromFile, iconFromUrl } from "@/features/mcp";
import { cn } from "@/lib/utils";
import { ImageUpIcon, LinkIcon, LoaderIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

/**
 * The connector's icon in a dialog header, clickable to change it: upload a
 * picture or paste an image link. `value` is a draft — the dialog saves it.
 */
export function IconPicker({
  value,
  onChange,
  fallback,
  className,
}: {
  /** The picked icon as a `data:` URL; null shows `fallback`. */
  value: string | null;
  onChange: (icon: string | null) => void;
  /** The connector's own icon, shown when nothing is picked. */
  fallback: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState<"file" | "link">();
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = async (kind: "file" | "link", work: () => Promise<string>) => {
    setLoading(kind);
    setError(undefined);
    try {
      onChange(await work());
      setLink("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(undefined);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => (setOpen(next), next || setError(undefined))}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Change icon"
          aria-label="Change icon"
          className={cn(
            "group/icon relative size-14 shrink-0 overflow-hidden rounded-2xl ring-1 ring-border/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            className,
          )}
        >
          {value ? (
            <span className="flex size-full items-center justify-center bg-background">
              <img src={value} alt="" draggable={false} className="size-full object-contain p-1.5" />
            </span>
          ) : (
            fallback
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100 group-data-[state=open]/icon:opacity-100">
            <PencilIcon className="size-4" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80 gap-3 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Connector icon</p>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcwIcon className="size-3" />
              Use default
            </button>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void apply("file", () => iconFromFile(file));
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full justify-center gap-2"
          disabled={!!loading}
          onClick={() => fileRef.current?.click()}
        >
          {loading === "file" ? <LoaderIcon className="size-4 animate-spin" /> : <ImageUpIcon className="size-4" />}
          Upload image
        </Button>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground uppercase">
          <span className="h-px flex-1 bg-border" />
          or link
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring">
            <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                // Inside the dialog's form: Enter must not save the whole dialog.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (link.trim()) void apply("link", () => iconFromUrl(link));
                }
              }}
              placeholder="https://example.com/logo.png"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </label>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!link.trim() || !!loading}
            onClick={() => void apply("link", () => iconFromUrl(link))}
          >
            {loading === "link" ? <LoaderIcon className="size-4 animate-spin" /> : "Use"}
          </Button>
        </div>

        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">PNG, JPG, SVG or WebP. Square images look best.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
