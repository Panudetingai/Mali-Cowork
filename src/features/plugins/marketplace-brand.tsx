import type { PluginSource } from "@/features/plugins/types";
import { resolvePluginSource as defaultResolvePluginSource, examplePluginDir as defaultExamplePluginDir } from "@/features/plugins/api";
import { cn } from "@/lib/utils";
import { Claude, Github, Google } from "@lobehub/icons";
import { FolderOpen, PuzzleIcon, Store } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Which mark to show on a marketplace or plugin tile. */
export type MarketplaceBrandId = "claude" | "github" | "folder" | "store" | "PuzzleIcon" | "google" | "mobbin";

/** Optional remote logo when LobeHub has no mark. */
const BRAND_IMAGE: Partial<Record<MarketplaceBrandId, string>> = {
  mobbin: "https://iconlogovector.com/uploads/images/2025/08/lg-68945c89a696b-Mobbin.webp",
};

/** Wordmark-style logos need a wider slot than square marks. */
const WIDE_BRAND = new Set<MarketplaceBrandId>(["mobbin"]);

export type SuggestedPlugin = {
  label: string;
  /** Passed to `plugins_resolve` (GitHub repo, tree path, or folder). */
  input: string;
  description: string;
  brand: MarketplaceBrandId;
  /** Installed plugin id when present. */
  pluginId: string;
  imageUrl?: string;
  /** Folder under `docs/examples/` bundled with the app. */
  localDir?: string;
};

/** One-click installs for common connectors (MCP via plugin). */
export const SUGGESTED_PLUGINS: SuggestedPlugin[] = [
  {
    label: "Mobbin",
    input: "Panudetingai/Mali-Cowork/tree/main/docs/examples/mobbin-plugin",
    description:
      "Search real app screens and flows from Mobbin — like browsing iOS patterns on mobbin.com. OAuth with your Mobbin Pro/Team account on first connect.",
    brand: "mobbin",
    pluginId: "mobbin",
    localDir: "mobbin-plugin",
  },
  {
    label: "Google Calendar",
    input: "Panudetingai/Mali-Cowork/tree/main/docs/examples/google-calendar-mcp-plugin",
    description:
      "List, create, and update calendar events. After install, connect the connector and set GOOGLE_OAUTH_CREDENTIALS to your Google Cloud Desktop OAuth JSON.",
    brand: "google",
    pluginId: "google-calendar",
    localDir: "google-calendar-mcp-plugin",
  },
];

/** Recommended plugin: local example first, then GitHub. */
export async function resolveSuggestedPlugin(
  suggestion: SuggestedPlugin,
  resolve: (input: string) => Promise<PluginSource> = defaultResolvePluginSource,
  localDir: (name: string) => Promise<string | null> = defaultExamplePluginDir,
): Promise<PluginSource> {
  if (suggestion.localDir) {
    const path = await localDir(suggestion.localDir);
    if (path) return { kind: "folder", path };
  }
  return resolve(suggestion.input);
}

export function isSuggestedPluginInstalled(
  plugins: { id: string; source: PluginSource }[],
  suggestion: SuggestedPlugin,
): boolean {
  const tail = suggestion.input.split("/").pop()?.toLowerCase() ?? "";
  return plugins.some(
    (p) =>
      p.id === suggestion.pluginId ||
      (tail.length > 3 && p.source.kind === "github" && p.source.dir.toLowerCase().includes(tail.replace("-plugin", ""))),
  );
}

export type SuggestedMarketplace = {
  label: string;
  input: string;
  description: string;
  brand: MarketplaceBrandId;
  imageUrl?: string;
};

/** Curated Claude Code marketplaces until the user adds them. */
export const SUGGESTED_MARKETPLACES: SuggestedMarketplace[] = [
  {
    label: "Claude plugins (official)",
    input: "anthropics/claude-plugins-official",
    description: "Anthropic’s directory of connectors and curated plugins.",
    brand: "claude",
  },
  {
    label: "Claude Code plugins",
    input: "anthropics/claude-code",
    description: "Plugins bundled with Claude Code: reviews, commits, Agent SDK.",
    brand: "claude",
  },
  {
    label: "ECC",
    input: "affaan-m/ecc",
    description: "Your agent can write code, but ECC gives it a coordinated engineering system and toolbox: it plans before it builds, verifies changes with tests, reviews its own work from a fresh context, remembers what matters, and turns repeated wins into reusable skills and workflows.",
    brand: "PuzzleIcon",
  },
  {
    label: "Superpowers",
    input: "obra/superpowers",
    description: "Workflow plugins for planning, TDD, and disciplined agent loops.",
    brand: "PuzzleIcon",
  },
  {
    label: "Agents",
    input: "wshobson/agents",
    description: "Specialized subagents and toolkits for Claude Code.",
    brand: "github",
  },
  {
    label: "Compound engineering",
    input: "EveryInc/compound-engineering-plugin",
    description: "Compound’s engineering plugin marketplace.",
    brand: "claude",
  },
  {
    label: "Yarlson plugins",
    input: "yarlson/claude-plugins",
    description: "Dev workflows including autonomous development flow.",
    brand: "PuzzleIcon",
  },
  {
    label: "Ponytail",
    input: "DietrichGebert/ponytail",
    description: "Ponytail marketplace — install plugins with plugin@marketplace.",
    brand: "PuzzleIcon",
  },
];

const BRAND_BY_REPO = new Map(
  SUGGESTED_MARKETPLACES.map((s) => [s.input.toLowerCase(), s.brand] as const),
);

export function marketplaceRepoKey(source: PluginSource): string | null {
  if (source.kind !== "github") return null;
  return `${source.owner}/${source.repo}`.toLowerCase();
}

/** Pick an icon for a saved or suggested marketplace. */
export function resolveMarketplaceBrand(
  source: PluginSource,
  name?: string,
  owner?: string,
): MarketplaceBrandId {
  const key = marketplaceRepoKey(source);
  if (key) {
    const known = BRAND_BY_REPO.get(key);
    if (known) return known;
    if (source.kind === "github" && source.owner.toLowerCase() === "anthropics") return "claude";
  }
  const haystack = `${name ?? ""} ${owner ?? ""} ${key ?? ""}`.toLowerCase();
  if (/claude|anthropic/.test(haystack)) return "claude";
  if (/google|calendar|gmail/.test(haystack)) return "google";
  if (/mobbin/.test(haystack)) return "mobbin";
  if (source.kind === "folder") return "folder";
  if (source.kind === "github") return "github";
  return "PuzzleIcon";
}

function BrandImage({
  src,
  wide,
  muted,
  invertInDark,
  fallback,
}: {
  src: string;
  wide?: boolean;
  muted?: boolean;
  invertInDark?: boolean;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      className={cn(
        "brand-logo-img block shrink-0 object-contain object-left",
        wide
          ? "h-10 w-29 origin-left scale-[2.15] motion-reduce:scale-100"
          : "size-10",
        invertInDark && "dark:invert",
        muted && "opacity-70",
      )}
      onError={() => setFailed(true)}
    />
  );
}

export function MarketplaceBrandIcon({
  brand,
  size = 32,
  muted,
  imageUrl,
}: {
  brand: MarketplaceBrandId;
  size?: number;
  muted?: boolean;
  /** Overrides the default image for this brand. */
  imageUrl?: string;
}) {
  const tone = muted ? "opacity-70" : undefined;
  const img = imageUrl ?? BRAND_IMAGE[brand];
  const wide = WIDE_BRAND.has(brand);
  if (img) {
    return (
      <span
        className={cn(
          "marketplace-brand-icon flex shrink-0 items-center justify-start",
          wide ? "h-11 w-29 overflow-hidden" : "size-11 items-center justify-center overflow-hidden rounded-md bg-muted/30",
        )}
        aria-hidden
      >
        <BrandImage
          src={img}
          wide={wide}
          muted={muted}
          invertInDark={brand === "mobbin"}
          fallback={
            brand === "mobbin" ? (
              <span
                className={cn(
                  "flex size-12 items-center justify-center rounded-md bg-neutral-900 text-xs font-bold text-white",
                  tone,
                )}
              >
                M
              </span>
            ) : (
              <PuzzleIcon size={Math.round(size * 0.78)} className={tone} />
            )
          }
        />
      </span>
    );
  }
  switch (brand) {
    case "claude":
      return <Claude.Color size={size} aria-hidden />;
    case "github":
      return <Github size={size} aria-hidden />;
    case "folder":
      return <FolderOpen size={Math.round(size * 0.78)} className={tone} aria-hidden />;
    case "store":
      return <Store size={Math.round(size * 0.78)} className={tone} aria-hidden />;
    case "PuzzleIcon":
      return <PuzzleIcon size={size} aria-hidden />;
    case "google":
      return <Google.Color size={size} className={tone} aria-hidden />;
    case "mobbin":
      return (
        <span aria-hidden className="marketplace-brand-icon flex h-11 w-[7.5rem] shrink-0 items-center overflow-hidden">
          <BrandImage
            src={BRAND_IMAGE.mobbin!}
            wide
            invertInDark
            fallback={
              <span className="flex size-10 items-center justify-center rounded-md bg-neutral-900 text-sm font-bold text-white">
                M
              </span>
            }
          />
        </span>
      );
  }
}

export function marketplaceTileIcon(
  source: PluginSource,
  options?: { name?: string; owner?: string; muted?: boolean; imageUrl?: string },
): ReactNode {
  const brand = resolveMarketplaceBrand(source, options?.name, options?.owner);
  return <MarketplaceBrandIcon brand={brand} muted={options?.muted} imageUrl={options?.imageUrl} />;
}

/** Pasted in “Add plugin” by mistake — image links are not GitHub repos. */
export function looksLikePluginImageUrl(input: string): boolean {
  const s = input.trim();
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(s) && (s.includes("://") || s.startsWith("www."));
}
