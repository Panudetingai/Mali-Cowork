import {
  Tab,
  TabGroup,
  TabHighlight,
  TabHighlightItem,
  TabList,
  TabPanel,
  TabPanels,
} from "@/components/animate-ui/primitives/headless/tabs";
import { cn } from "@/lib/utils";
import { BookOpenIcon, BotIcon, FolderIcon, NotebookPenIcon, SparklesIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AgentsSettings } from "./agents-settings";
import { FoldersSettings } from "./folders-settings";
import { InstructionsSettings } from "./instructions-settings";
import { McpTabIcon } from "./mcp/mcp-icon";
import { McpSettings } from "./mcp/mcp-settings";
import { ModelsSettings } from "./models-settings";
import { SkillsSettings } from "./skills/skills-settings";

const TABS = [
  { id: "models", label: "Models", description: "AI providers & keys", icon: SparklesIcon },
  { id: "agents", label: "Agents", description: "Cowork CLIs", icon: BotIcon },
  { id: "instructions", label: "Instructions", description: "Tone & context", icon: NotebookPenIcon },
  { id: "skills", label: "Skills", description: "How-tos the AI follows", icon: BookOpenIcon },
  { id: "mcp", label: "Connectors", description: "Apps & MCP tools", lobeMcp: true as const },
  { id: "folders", label: "Folders", description: "Disk access", icon: FolderIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB = cn(
  "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors",
  "hover:text-foreground",
  "data-active:text-foreground",
);

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "models";
  const selectedIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const active = TABS[selectedIndex];

  const goTo = (index: number) => {
    const id = TABS[index]?.id ?? "models";
    setParams(id === "models" ? {} : { tab: id }, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <TabGroup selectedIndex={selectedIndex} onChange={goTo} className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-56 xl:w-60">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Configure models, agents, and what Cowork can access on your Mac.
            </p>
          </header>

          <nav aria-label="Settings sections" className="scroll-hidden -mx-1 overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0">
            <TabHighlight className="rounded-xl bg-primary/60 p-1 lg:bg-primary/60">
              <TabList className="relative flex min-w-min flex-row gap-0.5 lg:min-w-0 lg:flex-col">
                {TABS.map((item, index) => {
                  const Icon = "icon" in item ? item.icon : null;
                  return (
                    <TabHighlightItem key={item.id} index={index} className="lg:w-full">
                      <Tab index={index} className={cn(TAB, "lg:justify-start")}>
                        {"lobeMcp" in item && item.lobeMcp ? (
                          <McpTabIcon />
                        ) : (
                          Icon && <Icon className="size-4 shrink-0" />
                        )}
                        <span className="flex min-w-0 flex-col items-start leading-tight">
                          <span className="truncate">{item.label}</span>
                          <span className="hidden text-[11px] font-normal text-muted-foreground lg:block">
                            {item.description}
                          </span>
                        </span>
                      </Tab>
                    </TabHighlightItem>
                  );
                })}
              </TabList>
            </TabHighlight>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-6 flex flex-col gap-0.5 border-b border-border/60 pb-6 lg:hidden">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{active.label}</p>
            <p className="text-sm text-muted-foreground">{active.description}</p>
          </div>

          <TabPanels mode="layout">
            <TabPanel>
              <ModelsSettings />
            </TabPanel>
            <TabPanel>
              <AgentsSettings />
            </TabPanel>
            <TabPanel>
              <InstructionsSettings />
            </TabPanel>
            <TabPanel>
              <SkillsSettings />
            </TabPanel>
            <TabPanel>
              <McpSettings />
            </TabPanel>
            <TabPanel>
              <FoldersSettings />
            </TabPanel>
          </TabPanels>
        </div>
      </TabGroup>
    </div>
  );
}
