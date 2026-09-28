"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAttachmentPreview, type Attachment } from "@/features/attachments";
import type { MediaKind } from "@/features/visual";
import { cn } from "@/lib/utils";
import { FolderUpIcon, ImageIcon, LinkIcon, LoaderIcon, PlusIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";

/** Extensions a reference may have; matches what the providers read. */
export const REFERENCE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

export function isReferenceImage(path: string) {
  return REFERENCE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
}

const TILE = "flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl text-[11px]";

function hintFor(kind: MediaKind, max: number, modelName?: string) {
  if (max === 0) {
    return `${modelName ?? "This model"} can't start from a reference picture. Pick another model to use one.`;
  }
  return kind === "image"
    ? `Supports uploading images (up to ${max}) as generation references`
    : `Supports uploading an image (up to ${max}) as the video's first frame`;
}

type Props = {
  kind: MediaKind;
  references: Attachment[];
  /** How many this model takes; 0 disables the tiles. */
  max: number;
  modelName?: string;
  /** Files being copied in. */
  importing: number;
  onPick: () => void;
  onLink: (url: string) => Promise<void>;
  onRemove: (id: string) => void;
};

/**
 * The row above the prompt: reference pictures, and the tiles that add them.
 * Image creation has one "Image" tile; video has "Reference" and "File/Link".
 */
export function ReferenceTiles({ kind, references, max, modelName, importing, onPick, onLink, onRemove }: Props) {
  const full = references.length + importing >= max;
  const disabled = max === 0;
  const hint = hintFor(kind, max, modelName);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {references.map((reference) => (
          <motion.div
            key={reference.id}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ReferenceThumb reference={reference} onRemove={() => onRemove(reference.id)} over={references.length > max} />
          </motion.div>
        ))}
        {Array.from({ length: importing }, (_, i) => (
          <motion.div
            key={`importing-${i}`}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={cn(TILE, "bg-muted/60 text-muted-foreground")}
          >
            <LoaderIcon className="size-4 animate-spin" />
          </motion.div>
        ))}
      </AnimatePresence>

      {!full || disabled ? (
        <HintTile hint={hint}>
          <button
            type="button"
            onClick={onPick}
            disabled={disabled}
            aria-label={kind === "image" ? "Add reference image" : "Add reference"}
            className={cn(
              TILE,
              "bg-muted/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-muted/70 disabled:hover:text-muted-foreground",
            )}
          >
            {kind === "image" ? <ImageIcon className="size-4" /> : <PlusIcon className="size-4" />}
            {kind === "image" ? "Image" : "Reference"}
          </button>
        </HintTile>
      ) : null}

      {kind === "video" && (!full || disabled) && (
        <LinkTile disabled={disabled} hint={disabled ? hint : "Add a picture from a file or an https link"} onPick={onPick} onLink={onLink} />
      )}
    </div>
  );
}

function HintTile({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <Tooltip>
      {/* A span, so the hint still shows while the button is disabled. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function ReferenceThumb({ reference, onRemove, over }: { reference: Attachment; onRemove: () => void; over: boolean }) {
  const url = useAttachmentPreview(reference);
  return (
    <div
      className={cn("group/ref relative size-16 overflow-hidden rounded-2xl bg-muted", over && "ring-2 ring-destructive/60")}
      title={over ? `${reference.name} — more than this model takes` : reference.name}
    >
      {url ? (
        <img src={url} alt={reference.name} className="size-full object-cover" />
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${reference.name}`}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/ref:opacity-100 focus-visible:opacity-100"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

function LinkTile({
  disabled,
  hint,
  onPick,
  onLink,
}: {
  disabled: boolean;
  hint: string;
  onPick: () => void;
  onLink: (url: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const add = async () => {
    const link = url.trim();
    if (!link) return;
    setBusy(true);
    setError(undefined);
    try {
      await onLink(link);
      setUrl("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTile hint={hint}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            disabled={disabled}
            aria-label="Add from a file or link"
            className={cn(
              TILE,
              "bg-muted/40 text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-muted/40",
            )}
          >
            <FolderUpIcon className="size-4" />
            File/Link
          </button>
        </PopoverTrigger>
      </HintTile>
      <PopoverContent side="top" align="start" className="w-80 p-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label className="text-xs font-medium" htmlFor="reference-link">
            Picture link
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reference-link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/picture.png"
                className="h-8 pl-8 text-sm"
                autoFocus
              />
            </div>
            <Button type="submit" size="sm" className="h-8" disabled={!url.trim() || busy}>
              {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : "Add"}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              setOpen(false);
              onPick();
            }}
          >
            <FolderUpIcon className="size-3.5" />
            Choose a file…
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
