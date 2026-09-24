/**
 * Root of the Quick bar window (`index.html?window=quick`). Placeholder until
 * the Quick bar UI lands — see docs/HANDOFF-cursor-epic-a.md.
 */
import { useEffect, useState } from "react";
import { hideQuick, onQuickOpened, takeQuickContext } from "./api";
import type { QuickContext } from "./types";

export function QuickBarRoot() {
  const [context, setContext] = useState<QuickContext>();

  useEffect(() => {
    const load = () => void takeQuickContext().then(setContext);
    load();
    const unlisten = onQuickOpened(load);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && void hideQuick();
    window.addEventListener("keydown", onKey);
    return () => {
      void unlisten.then((stop) => stop());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col gap-2 bg-background p-4 text-sm text-foreground">
      <p className="font-medium">Mali Quick</p>
      <p className="text-muted-foreground">
        {context?.clipboardText ? `Clipboard: ${context.clipboardText.slice(0, 80)}` : "Clipboard ว่าง"}
      </p>
    </div>
  );
}
