import { toast } from "@/components/ui/sonner";
import {
  describePluginInstall,
  installedNames,
  installPlugin,
  type PluginChoices,
  type PluginPackage,
} from "@/features/plugins";
import { useState } from "react";

type Pending = {
  plugin: PluginPackage;
  /** On an update: what's installed now, by name. */
  installed?: ReturnType<typeof installedNames>;
  marketplace?: string;
  overlay?: Record<string, unknown>;
};

/** One plugin waiting in the install dialog, and installing what the user kept. */
export function usePluginInstall(onDone?: (id: string) => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const review = (plugin: PluginPackage, options: { update?: boolean; marketplace?: string; overlay?: Record<string, unknown> } = {}) =>
    setPending({
      plugin,
      installed: options.update ? installedNames(plugin.id) : undefined,
      marketplace: options.marketplace,
      overlay: options.overlay,
    });

  const install = async (choices: PluginChoices) => {
    if (!pending) return;
    setBusy(true);
    try {
      const report = await installPlugin(pending.plugin, choices, {
        marketplace: pending.marketplace,
        overlay: pending.overlay,
      });
      const text = describePluginInstall(report);
      if (report.skipped.length) {
        toast.warning(text, {
          description: `Left out: ${report.skipped.slice(0, 4).join("; ")}${report.skipped.length > 4 ? ` and ${report.skipped.length - 4} more` : ""}`,
        });
      } else {
        toast.success(text);
      }
      const id = pending.plugin.id;
      setPending(null);
      onDone?.(id);
    } catch (error) {
      toast.error("Couldn’t install the plugin", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return { pending, busy, review, install, cancel: () => setPending(null) };
}
