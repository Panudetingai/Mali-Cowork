import { cn } from "@/lib/utils";
import { ProviderIcon } from "@lobehub/icons";
import { useState } from "react";
import { lobeProviderKey } from "./lobe";

type Props = {
  /** Our provider id from catalog.ts (e.g. "openai", "zai"). */
  logo: string;
  name: string;
  className?: string;
};

/**
 * Brand icon from LobeHub (inline SVG, works offline in Tauri) with a
 * models.dev image fallback and a letter tile as last resort.
 * Browse: https://lobehub.com/icons
 */
export function ProviderLogo({ logo, name, className }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const lobeKey = lobeProviderKey(logo);

  if (lobeKey) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
        <ProviderIcon provider={lobeKey} size={24} type="color" />
      </span>
    );
  }

  if (!imgFailed) {
    return (
      <img
        src={`https://models.dev/logos/${logo}.svg`}
        alt=""
        width={24}
        height={24}
        className={cn("size-6 shrink-0 dark:invert", className)}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {name.charAt(0)}
    </span>
  );
}
