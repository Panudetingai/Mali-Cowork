import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { mediaGenerateStream } from "@/features/media";
import { useOpencode } from "@/features/opencode";
import { listConfiguredProviders, requestConfigFor, useEnvKeys, useProviderConfigs } from "@/features/providers";
import {
  addVisualItems,
  getImageSettings,
  getVideoSettings,
  patchImageSettings,
  patchVideoSettings,
  SIZES,
  useImageSettings,
  useVideoSettings,
  useVisualItems,
  type MediaKind,
} from "@/features/visual";
import { apiModelOf, buildMediaCatalog, type AiModel } from "@/pages/chat/models";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, LoaderIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { VisualEmptyWelcome, VisualGallery } from "./gallery";
import { VisualModelSelect } from "./model-select";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opencode = useOpencode();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const image = useImageSettings();
  const video = useVideoSettings();
  const items = useVisualItems();

  const models = useMemo(
    () => buildMediaCatalog(opencode.models, listConfiguredProviders(configs, envKeys), kind),
    [opencode.models, configs, envKeys, kind],
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
  const isEmpty = models.length === 0 || shown.length === 0;
  const canSend = prompt.trim().length > 0 && !!selected && !busy;

  const pick = (model: AiModel) =>
    kind === "image"
      ? patchImageSettings({ modelId: model.id })
      : patchVideoSettings({ modelId: model.id });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || !selected) return;
    const api = apiModelOf(selected.id);
    if (!api) return;

    const text = prompt.trim();
    setBusy(true);
    setError(null);
    const made: string[] = [];

    await new Promise<void>((done) => {
      mediaGenerateStream(
        {
          prompt: text,
          provider: api.provider,
          model: api.model,
          kind,
          ...requestConfigFor(api.provider),
          ...(kind === "image"
            ? {
                count: getImageSettings().count,
                aspectRatio: SIZES.find((s) => s.id === getImageSettings().sizeId)?.ratio ?? null,
              }
            : {
                aspectRatio: SIZES.find((s) => s.id === getVideoSettings().sizeId)?.ratio ?? null,
                resolution: getVideoSettings().resolution,
                durationSeconds:
                  getVideoSettings().durationMode === "custom"
                    ? getVideoSettings().seconds
                    : undefined,
              }),
        },
        {
          // The reply is a ```media block per file; the paths are what we keep.
          onChunk: (chunk) => {
            for (const [, path] of chunk.matchAll(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
              made.push(JSON.parse(`"${path}"`));
            }
          },
          onError: (message) => {
            setError(message);
            done();
          },
          onDone: () => done(),
        },
      ).catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        done();
      });
    });

    if (made.length > 0) {
      addVisualItems(
        made.map((path, at) => ({
          id: `${Date.now()}-${at}`,
          kind,
          path,
          prompt: text,
          modelId: selected.id,
          createdAt: Date.now(),
        })),
      );
      setPrompt("");
    }
    setBusy(false);
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
        className={cn(
          "mt-5 min-h-0 flex-1",
          isEmpty ? "flex items-center justify-center overflow-hidden" : "overflow-y-auto",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isEmpty ? (
            <VisualEmptyWelcome key={`empty-${kind}`} kind={kind} />
          ) : (
            <VisualGallery key="gallery" items={shown} />
          )}
        </AnimatePresence>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="relative mt-4 shrink-0">
        {/* The soft glow of the mock, kept behind the card so it never tints
            the controls: a blurred copy of the card's own footprint. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-2 rounded-[28px] opacity-40 blur-xl transition-colors",
          )}
        />
        <div className="relative flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Textarea
              value={prompt}
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
                disabled={busy}
              />
              <Button
                type="submit"
                size="icon-sm"
                className="rounded-full"
                disabled={!canSend}
                aria-label={busy ? "Making it" : "Make it"}
              >
                {busy ? <LoaderIcon className="animate-spin" /> : <ArrowUpIcon />}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
