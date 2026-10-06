import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { fetchSkillsFromUrl, saveSkill, useInstructions, type SkillCandidate } from "@/features/instructions";
import { saveMarketplace } from "@/features/plugins/store";
import { InstallPluginDialog } from "@/pages/settings/plugins/install-plugin-dialog";
import { usePluginInstall } from "@/pages/settings/plugins/use-plugin-install";
import { InstallSkillDialog, type InstallChoice } from "@/pages/settings/skills/install-skill-dialog";
import { describeInstall, useSkillInstall } from "@/pages/settings/skills/use-skill-install";
import { Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { closeChatInstallRequest, useChatInstallRequest } from "./request";
import { fetchPluginFromChatInput } from "./resolve-plugin";

/**
 * Install plugins or skills from a command pasted in Cowork, Code or Chat —
 * same dialogs as Settings, opened from the app shell like connector installs.
 */
export function ChatInstallDialog() {
  const request = useChatInstallRequest();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<SkillCandidate[] | null>(null);
  const { skills } = useInstructions();
  const skillInstaller = useSkillInstall((draft) => saveSkill(draft), skills);
  const pluginInstaller = usePluginInstall();

  useEffect(() => {
    if (!request) {
      setLoadError(null);
      setSkillCandidates(null);
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);
    setLoadError(null);
    setSkillCandidates(null);
    pluginInstaller.cancel();

    (async () => {
      try {
        if (request.kind === "skill") {
          const found = await fetchSkillsFromUrl(request.input);
          if (!live) return;
          if (found.length === 0) {
            setLoadError("No skills found for that command.");
            return;
          }
          setSkillCandidates(found);
        } else {
          const fetched = await fetchPluginFromChatInput(request.input);
          if (!live) return;
          if (fetched.plugin) {
            pluginInstaller.review(fetched.plugin, {
              marketplace: fetched.marketplace,
              overlay: fetched.overlay,
            });
          } else if (fetched.marketplace) {
            saveMarketplace(fetched.marketplace);
            toast.success(`Marketplace “${fetched.marketplace.name}” added`, {
              description: "Open Settings → Plugins to install a plugin from it.",
            });
            closeChatInstallRequest();
          } else {
            setLoadError("That source doesn't list a plugin.");
          }
        }
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when request identity changes
  }, [request?.kind, request?.input]);

  const closeAll = () => {
    closeChatInstallRequest();
    setSkillCandidates(null);
    setLoadError(null);
    pluginInstaller.cancel();
  };

  const installSkills = async (choices: InstallChoice[]) => {
    try {
      const result = await skillInstaller.install(choices);
      toast.success(describeInstall(result));
      closeAll();
    } catch (e) {
      toast.error("Couldn't install skills", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const busy = loading || skillInstaller.busy || pluginInstaller.busy;

  return (
    <>
      <Dialog open={!!request && loading && !pluginInstaller.pending && !skillCandidates} onOpenChange={(open) => !open && !busy && closeAll()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reading install command</DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              <Loader className="size-4 animate-spin" />
              Downloading from GitHub…
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={!!loadError && !!request} onOpenChange={(open) => !open && closeAll()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Couldn't install</DialogTitle>
            <DialogDescription>{loadError}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <InstallSkillDialog
        candidates={request?.kind === "skill" ? skillCandidates : null}
        existing={skills}
        busy={skillInstaller.busy}
        onInstall={(choices) => void installSkills(choices)}
        onClose={() => !skillInstaller.busy && closeAll()}
      />

      <InstallPluginDialog
        plugin={pluginInstaller.pending?.plugin ?? null}
        installed={pluginInstaller.pending?.installed}
        busy={pluginInstaller.busy}
        onInstall={(choices) => void pluginInstaller.install(choices).then(() => closeChatInstallRequest())}
        onClose={() => !pluginInstaller.busy && closeAll()}
      />
    </>
  );
}
