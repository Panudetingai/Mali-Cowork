import { cn } from "@/lib/utils";
import { Antigravity, Codex, Cursor, ElevenLabs, FishAudio, OpenCode, ProviderIcon } from "@lobehub/icons";
import { Sparkles, SquareTerminal } from "lucide-react";
import { useState, type ComponentType } from "react";
import { lobeProviderKey } from "./lobe";

type CliIcon = ComponentType<{ size?: number }>;

/** CLI agents and voice services aren't in models.dev; LobeHub ships their marks. */
const CLI_AGENT_ICON: Record<string, CliIcon> = {
  cursor: Cursor,
  codex: Codex,
  antigravity: Antigravity,
  opencode: OpenCode,
  elevenlabs: ElevenLabs,
  fishaudio: FishAudio,
};

type Props = {
  /** Our provider id from catalog.ts (e.g. "openai", "zai"). */
  logo: string;
  name: string;
  className?: string;
  size?: number;
  /** User-provided image (custom CLI agents). */
  imageUrl?: string;
};

/**
 * Brand icon from LobeHub (inline SVG, works offline in Tauri) with a
 * models.dev image fallback and a letter tile as last resort.
 * Brands with no real mark (Puter) use the default tile instead of a
 * network image. Browse: https://lobehub.com/icons
 */
export function ProviderLogo({ logo, name, className, size = 24, imageUrl }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const [customFailed, setCustomFailed] = useState(false);
  if (imageUrl && !customFailed) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-[4px] object-cover", className)}
        style={{ width: size, height: size }}
        onError={() => setCustomFailed(true)}
      />
    );
  }
  const cli = CLI_AGENT_ICON[logo];
  if (cli) {
    const Icon = cli;
    return (
      <span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
        <Icon size={size} />
      </span>
    );
  }
  // A CLI the user added: a terminal mark rather than a guessed brand.
  if (logo === "terminal") {
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-[4px] bg-muted text-muted-foreground", className)}
        style={{ width: size, height: size }}
        title={name}
        aria-hidden
      >
        <SquareTerminal style={{ width: Math.max(10, Math.round(size * 0.62)), height: Math.max(10, Math.round(size * 0.62)) }} />
      </span>
    );
  }
  // No brand mark exists: a default tile, offline-safe and unmistakable.
  if (logo === "puter") {
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-[4px] bg-muted text-muted-foreground", className)}
        style={{ width: size, height: size }}
        title={name}
        aria-hidden
      >
        <Sparkles style={{ width: Math.max(10, Math.round(size * 0.62)), height: Math.max(10, Math.round(size * 0.62)) }} />
      </span>
    );
  }
  const lobeKey = lobeProviderKey(logo);

  if (lobeKey) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
        <ProviderIcon provider={lobeKey} size={size} type="color" />
      </span>
    );
  }

  // A provider the user added has no mark of its own: its initial.
  if (!imgFailed && logo !== "custom") {
    return (
      <img
        src={`https://models.dev/logos/${logo}.svg`}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 dark:invert", className)}
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm bg-muted font-semibold text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}
    >
      {name.charAt(0)}
    </span>
  );
}
