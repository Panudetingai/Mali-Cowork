import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { attachmentFromUrl, importAttachment, saveAttachment, type Attachment } from "@/features/attachments";
import { maxReferencesFor } from "@/features/media";
import { useOpencode } from "@/features/opencode";
import { listConfiguredProviders, requestConfigFor, useEnvKeys, useProviderConfigs } from "@/features/providers";
import {
  getImageSettings,
  getVideoSettings,
  patchImageSettings,
  patchVideoSettings,
  SIZES,
  startVisualJob,
  useImageSettings,
  useVideoSettings,
  useVisualItems,
  useVisualJobs,
  type MediaKind,
} from "@/features/visual";
import { apiModelOf, buildMediaCatalog, type AiModel } from "@/pages/chat/models";
import { puterModels, refreshPuterModels, usePuterModels } from "@/features/media/puter-catalog";
import { cn } from "@/lib/utils";
import { ArrowUpIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { VisualEmptyWelcome, VisualGallery } from "./gallery";
import { VisualModelSelect } from "./model-select";
import { isReferenceImage, REFERENCE_EXTENSIONS, ReferenceTiles } from "./references";
import { ImageSettingsBar, VideoSettingsBar } from "./settings-popover";

const TABS: { kind: MediaKind; label: string }[] = [
  { kind: "video", label: "Video Creation" },
  { kind: "image", label: "Image Creation" },
];

const PLACEHOLDER: Record<MediaKind, string> = {
  image: "Enter your image creation idea",
  video: "Describe the video you want",
};

/**
 * Making pictures and clips, away from the chat.
 *
 * These models answer with a file and nothing else — no conversation, no
 * tools, no folder — so they were the odd one out in the chat model list, and
 * the controls they need (size, count, length, resolution) have nowhere to
 * live in a chat composer. They get their own page, and the chat picker gets
 * its list of models that can actually hold a conversation back.
 */
export default function VisualPage() {
  const [kind, setKind] = useState<MediaKind>("image");
  const [prompt, setPrompt] = useState("");

  const opencode = useOpencode();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const image = useImageSettings();
  const video = useVideoSettings();
  const items = useVisualItems();
  const jobs = useVisualJobs();

  // Puter's models are whatever Puter offers now: asked for once it has a token.
  const puterLists = usePuterModels();
  const configured = useMemo(() => listConfiguredProviders(configs, envKeys), [configs, envKeys]);
  const onPuter = configured.some(({ provider }) => provider.id === "puter");
  useEffect(() => {
    if (onPuter) void refreshPuterModels(kind, requestConfigFor("puter").baseUrl).catch(() => undefined);
  }, [onPuter, kind]);
  const models = useMemo(
    () => buildMediaCatalog(opencode.models, configured, kind, puterLists[kind].length ? puterLists[kind] : puterModels(kind)),
    [opencode.models, configured, kind, puterLists],
  );
  const settings = kind === "image" ? image : video;
  const selected =
    models.find((m) => m.id === settings.modelId) ?? models[0];

  // The chosen model is remembered per kind, and falls back when a provider
  // is removed rather than sending a model id nothing can run.
  useEffect(() => {
    if (!selected || settings.modelId === selected.id) return;
    const patch = { modelId: selected.id };
    if (kind === "image") patchImageSettings(patch);
    else patchVideoSettings(patch);
  }, [kind, selected, settings.modelId]);

  const shown = useMemo(() => items.filter((item) => item.kind === kind), [items, kind]);
  const pending = useMemo(() => jobs.filter((job) => job.kind === kind), [jobs, kind]);
  const working = pending.some((job) => !job.error);
  const galleryRef = useRef<HTMLDivElement>(null);
  // A new job lands at the top of the gallery: bring it into view.
  const newest = pending[0]?.id;
  useEffect(() => {
    if (newest) galleryRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [newest]);
  const isEmpty = models.length === 0 || (shown.length === 0 && pending.length === 0);
  // Reference pictures, kept apart per tab: a video's first frame isn't an
  // image edit's source.
  const [refs, setRefs] = useState<Record<MediaKind, Attachment[]>>({ image: [], video: [] });
  const [importing, setImporting] = useState(0);
  const [refError, setRefError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const selectedApi = selected ? apiModelOf(selected.id) : undefined;
  const maxRefs = selectedApi ? maxReferencesFor(selectedApi.provider, selectedApi.model, kind) : 0;
  const references = refs[kind];
  // After a model change, more pictures than the new model takes: say so
  // before sending rather than after a round trip.
  const tooMany = references.length > maxRefs;
  const canSend = prompt.trim().length > 0 && !!selected && !tooMany;

  async function addReferences(sources: (string | File)[]) {
    setRefError(undefined);
    const pictures = sources.filter((s) => isReferenceImage(typeof s === "string" ? s : s.name) || (typeof s !== "string" && s.type.startsWith("image/")));
    if (pictures.length < sources.length) setRefError("Only pictures (PNG, JPEG, WebP, GIF) can be references.");
    const room = maxRefs - references.length - importing;
    if (room <= 0) {
      setRefError(maxRefs === 0 ? `${selected?.name ?? "This model"} can't start from a reference picture.` : `Up to ${maxRefs} reference picture${maxRefs === 1 ? "" : "s"} for this model.`);
      return;
    }
    if (pictures.length > room) setRefError(`Up to ${maxRefs} reference picture${maxRefs === 1 ? "" : "s"} for this model.`);
    const target = kind;
    const accepted = pictures.slice(0, room);
    setImporting((n) => n + accepted.length);
    await Promise.all(
      accepted.map(async (source) => {
        try {
          const added = typeof source === "string" ? await importAttachment(source) : await saveAttachment(source);
          setRefs((prev) => ({ ...prev, [target]: [...prev[target], added] }));
        } catch (error) {
          setRefError(String(error));
        } finally {
          setImporting((n) => n - 1);
        }
      }),
    );
  }

  const pickReferences = async () => {
    const picked = await open({
      multiple: maxRefs > 1,
      title: kind === "image" ? "Choose reference pictures" : "Choose the first frame",
      filters: [{ name: "Pictures", extensions: REFERENCE_EXTENSIONS }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) await addReferences(paths);
  };

  const addLink = async (url: string) => {
    if (references.length + importing >= maxRefs) throw new Error(`Up to ${maxRefs} reference picture${maxRefs === 1 ? "" : "s"} for this model.`);
    const added = await attachmentFromUrl(url);
    setRefs((prev) => ({ ...prev, [kind]: [...prev[kind], added] }));
  };

  const removeReference = (id: string) => {
    setRefError(undefined);
    setRefs((prev) => ({ ...prev, [kind]: prev[kind].filter((r) => r.id !== id) }));
  };

  const pastePictures = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void addReferences(files);
  };

  // Pictures dragged from Finder / Explorer onto the window.
  const addRef = useRef(addReferences);
  addRef.current = addReferences;
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else if (payload.type === "drop") {
          setDragging(false);
          if (payload.paths.length) void addRef.current(payload.paths);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const pick = (model: AiModel) =>
    kind === "image"
      ? patchImageSettings({ modelId: model.id })
      : patchVideoSettings({ modelId: model.id });

  // Sent straight into the gallery as a "making…" card; the box clears so
  // the next idea can go in while this one is made.
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !selected) return;
    const api = apiModelOf(selected.id);
    if (!api) return;
    const text = prompt.trim();
    const count = kind === "image" ? getImageSettings().count : 1;
    startVisualJob({
      kind,
      prompt: text,
      modelId: selected.id,
      modelName: selected.name,
      count,
      request: {
        prompt: text,
        provider: api.provider,
        model: api.model,
        kind,
        ...requestConfigFor(api.provider),
        ...(references.length ? { references: references.map((r) => r.path) } : {}),
        ...(kind === "image"
          ? {
              count,
              aspectRatio: SIZES.find((s) => s.id === getImageSettings().sizeId)?.ratio ?? null,
            }
          : {
              aspectRatio: SIZES.find((s) => s.id === getVideoSettings().sizeId)?.ratio ?? null,
              resolution: getVideoSettings().resolution,
              durationSeconds:
                getVideoSettings().durationMode === "custom" ? getVideoSettings().seconds : undefined,
            }),
      },
    });
    setPrompt("");
    setRefs((prev) => ({ ...prev, [kind]: [] }));
    setRefError(undefined);
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pt-6 pb-4 sm:px-6">
      <nav className="flex items-center gap-5 justify-center" aria-label="What to make">
        {TABS.map((tab) => (
          <Button
            key={tab.kind}
            variant="ghost"
            size="xs"
            onClick={() => setKind(tab.kind)}
            aria-current={tab.kind === kind}
            className={cn("transition-colors", tab.kind === kind ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground")}
          >
            {tab.label}
          </Button>
        ))}
      </nav>

      <div
        ref={galleryRef}
        className={cn(
          "mt-5 min-h-0 flex-1",
          isEmpty ? "flex items-center justify-center overflow-hidden" : "overflow-y-auto",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isEmpty ? (
            <VisualEmptyWelcome key={`empty-${kind}`} kind={kind} />
          ) : (
            <VisualGallery key="gallery" items={shown} jobs={pending} />
          )}
        </AnimatePresence>
      </div>

      <form onSubmit={submit} className="relative mt-4 shrink-0">
        {/* The soft glow of the mock, kept behind the card so it never tints
            the controls: a blurred copy of the card's own footprint. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-2 rounded-[28px] opacity-40 blur-xl transition-colors",
          )}
        />
        <div
          className={cn(
            "relative flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm transition-colors",
            dragging && maxRefs > 0 && "border-primary/60 bg-primary/[0.03]",
          )}
        >
          <ReferenceTiles
            kind={kind}
            references={references}
            max={maxRefs}
            modelName={selected?.name}
            importing={importing}
            onPick={() => void pickReferences()}
            onLink={addLink}
            onRemove={removeReference}
          />
          {(refError || tooMany) && (
            <p className="-mt-1 text-xs text-destructive">
              {tooMany
                ? maxRefs === 0
                  ? `${selected?.name ?? "This model"} can't start from a reference picture — remove ${references.length === 1 ? "it" : "them"} or pick another model.`
                  : `${selected?.name ?? "This model"} takes ${maxRefs} reference picture${maxRefs === 1 ? "" : "s"} — remove ${references.length - maxRefs}.`
                : refError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Textarea
              value={prompt}
              onPaste={pastePictures}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(event);
                }
              }}
              placeholder={PLACEHOLDER[kind]}
              rows={2}
              className="max-h-40 min-h-18 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {kind === "image" ? (
              <ImageSettingsBar settings={image} onChange={patchImageSettings} />
            ) : (
              <VideoSettingsBar settings={video} onChange={patchVideoSettings} />
            )}

            <div className="ml-auto flex items-center gap-1">
              <VisualModelSelect
                models={models}
                selected={selected}
                onSelect={pick}
              />
              <Button
                type="submit"
                size="icon-sm"
                className="rounded-full"
                disabled={!canSend}
                aria-label="Make it"
                title={working ? "Make another — the one in progress keeps going" : "Make it"}
              >
                <ArrowUpIcon />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
