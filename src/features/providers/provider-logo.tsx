import { cn } from "@/lib/utils";
import { ProviderIcon } from "@lobehub/icons";
import { useState } from "react";
import { lobeProviderKey } from "./lobe";

type Props = {
  /** Our provider id from catalog.ts (e.g. "openai", "zai"). */
  logo: string;
  name: string;
  className?: string;
  size?: number;
};

/**
 * Brand icon from LobeHub (inline SVG, works offline in Tauri) with a
 * models.dev image fallback and a letter tile as last resort.
 * Browse: https://lobehub.com/icons
 */
export function ProviderLogo({ logo, name, className, size = 24 }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const lobeKey = lobeProviderKey(logo);

  if (lobeKey) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
        <ProviderIcon provider={lobeKey} size={size} type="color" />
      </span>
    );
  }

  if (!imgFailed) {
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
