import { cn } from "@/lib/utils";
import { useState } from "react";

type Props = {
  logo: string;
  name: string;
  className?: string;
};

/** models.dev logo with a letter fallback when the image is missing or offline. */
export function ProviderLogo({ logo, name, className }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground",
          className,
        )}
      >
        {name.charAt(0)}
      </span>
    );
  }

  return (
    <img
      src={`https://models.dev/logos/${logo}.svg`}
      alt=""
      width={16}
      height={16}
      className={cn("size-4 shrink-0 dark:invert", className)}
      onError={() => setFailed(true)}
    />
  );
}
