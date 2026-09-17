import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";
import { AgentsSettings } from "./agents-settings";
import { FoldersSettings } from "./folders-settings";
import { ModelsSettings } from "./models-settings";

const TABS = [
  { id: "models", label: "Models" },
  { id: "agents", label: "Agents" },
  { id: "folders", label: "Folders" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "models";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-1 md:flex-row md:gap-8">
      <nav
        aria-label="Settings"
        className="flex shrink-0 gap-1 md:w-40 md:flex-col md:gap-0.5 md:pt-1"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setParams(item.id === "models" ? {} : { tab: item.id }, { replace: true })}
            className={cn(
              "rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:w-full",
              tab === item.id && "bg-muted text-foreground shadow-xs",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 pb-6">
        {tab === "models" && <ModelsSettings />}
        {tab === "agents" && <AgentsSettings />}
        {tab === "folders" && <FoldersSettings />}
      </div>
    </div>
  );
}
