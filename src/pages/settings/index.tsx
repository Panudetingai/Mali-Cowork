import { cn } from "@/lib/utils";
import { BotIcon, FolderIcon, PlugIcon, SparklesIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AgentsSettings } from "./agents-settings";
import { FoldersSettings } from "./folders-settings";
import { McpSettings } from "./mcp/mcp-settings";
import { ModelsSettings } from "./models-settings";

const TABS = [
  { id: "models", label: "Models", icon: SparklesIcon },
  { id: "agents", label: "Agents", icon: BotIcon },
  { id: "mcp", label: "MCP", icon: PlugIcon },
  { id: "folders", label: "Folders", icon: FolderIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "models";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pt-5 pb-10 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Models, agents, integrations and folder access for Mali Cowork.
        </p>
      </header>

      {/* Segmented tabs; scrolls sideways on narrow windows instead of wrapping. */}
      <nav
        aria-label="Settings sections"
        className="scroll-hidden -mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <div role="tablist" className="inline-flex gap-1 rounded-xl border bg-muted/50 p-1">
          {TABS.map((item) => {
            const active = tab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParams(item.id === "models" ? {} : { tab: item.id }, { replace: true })}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors",
                  "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active && "bg-background text-foreground shadow-sm ring-1 ring-foreground/10",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-5 border-t pt-6">
        {tab === "models" && <ModelsSettings />}
        {tab === "agents" && <AgentsSettings />}
        {tab === "mcp" && <McpSettings />}
        {tab === "folders" && <FoldersSettings />}
      </div>
    </div>
  );
}
