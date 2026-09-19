import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ExternalLinkIcon, FolderOpenIcon, LoaderIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkpointDiff, checkpointPreview, openCheckpointFile } from "./api";
import { DiffLayoutToggle, DiffStat, DiffView, useDiffLayout } from "@/components/diff/diff-view";
import type { FileChange, FileDiff, FilePreview } from "./types";

type Tab = "preview" | "changes";

/** Text longer than this is shown plain instead of highlighted. */
const HIGHLIGHT_LIMIT = 150_000;

export const revealLabel = /Mac/i.test(navigator.userAgent)
  ? "Show in Finder"
  : /Win/i.test(navigator.userAgent)
    ? "Show in Explorer"
    : "Show in folder";

type Props = {
  checkpointId: string;
  change: FileChange | undefined;
  onOpenChange: (open: boolean) => void;
};

/** One changed file: what it looks like now, and what the turn changed. */
export function FilePreviewDialog({ checkpointId, change, onOpenChange }: Props) {
  const [tab, setTab] = useState<Tab>("preview");
  const [preview, setPreview] = useState<FilePreview>();
  const [diff, setDiff] = useState<FileDiff>();
  const [error, setError] = useState<string>();
  const [layout, setLayout] = useDiffLayout();

  const path = change?.path;
  useEffect(() => {
    setPreview(undefined);
    setDiff(undefined);
    setError(undefined);
    setTab(change?.kind === "modified" ? "changes" : "preview");
    if (!path) return;
    let cancelled = false;
    checkpointPreview(checkpointId, path)
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setError(String(e)));
    checkpointDiff(checkpointId, path)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [checkpointId, path, change?.kind]);

  const open = (reveal: boolean) => {
    if (path) openCheckpointFile(checkpointId, path, reveal).catch((e) => setError(String(e)));
  };

  return (
    <Dialog open={!!change} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="truncate">{change?.relative.split(/[\\/]/).pop()}</DialogTitle>
          <DialogDescription className="truncate" title={change?.path}>
            {change?.path}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1">
          {(["preview", "changes"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                tab === t ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "preview" ? "Preview" : "Changes"}
              {t === "changes" && diff?.kind === "text" && (
                <DiffStat additions={diff.additions} deletions={diff.deletions} className="ml-1.5" />
              )}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {tab === "changes" && diff?.kind === "text" && <DiffLayoutToggle layout={layout} onChange={setLayout} />}
            {change?.kind !== "deleted" && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => open(false)}>
                <ExternalLinkIcon className="size-3.5" />
                Open
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => open(true)}>
              <FolderOpenIcon className="size-3.5" />
              {revealLabel}
            </Button>
          </div>
        </div>

        <div className="min-h-40 flex-1 overflow-auto">
          {error ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : tab === "changes" ? (
            diff ? <DiffView diff={diff} layout={layout} /> : <Loading />
          ) : preview ? (
            <PreviewBody preview={preview} />
          ) : (
            <Loading />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10 text-muted-foreground">
      <LoaderIcon className="size-4 animate-spin" />
    </div>
  );
}

function PreviewBody({ preview }: { preview: FilePreview }) {
  const blobUrl = useBlobUrl(preview);
  const deleted = preview.deleted && (
    <p className="mb-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
      This file was deleted. This is how it looked before.
    </p>
  );

  switch (preview.kind) {
    case "markdown":
    case "document":
      return (
        <div className="px-1">
          {deleted}
          <MessageResponse className="text-sm">{preview.text ?? ""}</MessageResponse>
        </div>
      );
    case "text":
      return (
        <div className="px-1">
          {deleted}
          <CodePreview text={preview.text ?? ""} language={preview.language} />
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col items-center px-1">
          {deleted}
          {blobUrl && <img src={blobUrl} alt={preview.name} className="max-h-[60vh] max-w-full rounded-md object-contain" />}
        </div>
      );
    case "pdf":
      return (
        <div className="flex h-[60vh] flex-col px-1">
          {deleted}
          {blobUrl && <iframe src={blobUrl} title={preview.name} className="w-full flex-1 rounded-md border" />}
        </div>
      );
    default:
      return (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {preview.note ?? "No preview for this file."}
        </p>
      );
  }
}

function CodePreview({ text, language }: { text: string; language?: string }) {
  const markdown = useMemo(() => {
    if (text.length > HIGHLIGHT_LIMIT) return undefined;
    // A fence longer than any run of backticks in the file.
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${fence}${language ?? "text"}\n${text}\n${fence}`;
  }, [text, language]);
  if (!markdown) {
    return <pre className="whitespace-pre-wrap break-all rounded-lg border p-3 font-mono text-xs">{text}</pre>;
  }
  return <MessageResponse className="text-sm">{markdown}</MessageResponse>;
}

/** A blob URL for a picture or PDF preview, revoked when it changes. */
function useBlobUrl(preview: FilePreview) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!preview.data || (preview.kind !== "image" && preview.kind !== "pdf")) return;
    const bytes = Uint8Array.from(atob(preview.data), (c) => c.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: preview.mime }));
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [preview]);
  return url;
}
