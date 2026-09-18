import {
    Tab,
    TabGroup,
    TabHighlight,
    TabHighlightItem,
    TabList,
    TabPanel,
    TabPanels,
} from "@/components/animate-ui/primitives/headless/tabs";
import { cn } from "cn";
import { BotIcon, FolderIcon, SparklesIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AgentsSettings } from "./agents-settings";
import { FoldersSettings } from "./folders-settings";
import { McpTabIcon } from "./mcp/mcp-icon";
import { McpSettings } from "./mcp/mcp-settings";
import { ModelsSettings } from "./models-settings";

const TABS = [
  { id: "models", label: "Models", icon: SparklesIcon },
  { id: "agents", label: "Agents", icon: BotIcon },
  { id: "mcp", label: "MCP", lobeMcp: true as const },
  { id: "folders", label: "Folders", icon: FolderIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "models";
  const selectedIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));

  const goTo = (index: number) => {
    const id = TABS[index]?.id ?? "models";
    setParams(id === "models" ? {} : { tab: id }, { replace: true });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pt-5 pb-10 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Models, agents, integrations and folder access for Mali Cowork.
        </p>
      </header>

      <TabGroup selectedIndex={selectedIndex} onChange={goTo} className="mt-5 flex flex-col">
        <nav
          aria-label="Settings sections"
          className="scroll-hidden -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          <div className="relative inline-flex min-w-0">
            <TabHighlight className="absolute inset-0 z-0 rounded-lg border border-transparent bg-background shadow-sm ring-1 ring-foreground/10 dark:border-input dark:bg-input/30">
              <TabList className="relative inline-flex gap-1 rounded-xl border bg-muted/50 p-1">
                {TABS.map((item, index) => {
                  const Icon = "icon" in item ? item.icon : null;
                  return (
                    <TabHighlightItem key={item.id} index={index}>
                      <Tab
                        index={index}
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-500 ease-in-out",
                          "hover:text-foreground",
                          "data-active:text-foreground",
                        )}
                      >
                        {"lobeMcp" in item && item.lobeMcp ? (
                          <McpTabIcon />
                        ) : (
                          Icon && <Icon className="size-4" />
                        )}
                        {item.label}
                      </Tab>
                    </TabHighlightItem>
                  );
                })}
              </TabList>
            </TabHighlight>
          </div>
        </nav>

        <TabPanels mode="layout" className="mt-5 border-t pt-6">
          <TabPanel>
            <ModelsSettings />
          </TabPanel>
          <TabPanel>
            <AgentsSettings />
          </TabPanel>
          <TabPanel>
            <McpSettings />
          </TabPanel>
          <TabPanel>
            <FoldersSettings />
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
