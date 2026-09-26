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
import { BookOpenIcon, FileTextIcon, FolderIcon, GlobeIcon, NotebookPenIcon, ReceiptIcon, SparklesIcon, ZapIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Fragment } from "react";
import { FoldersSettings } from "./folders-settings";
import { GeneralSettings } from "./general-settings";
import { InstructionsSettings } from "./instructions-settings";
import { McpTabIcon } from "./mcp/mcp-icon";
import { McpSettings } from "./mcp/mcp-settings";
import { ModelsSettings } from "./models-settings";
import { QuickSettings } from "./quick-settings";
import { ReceiptSettings } from "./receipt-settings";
import { SkillsSettings } from "./skills/skills-settings";
import { TemplatesSettings } from "./templates-settings";
import { useTranslation, type TranslationKey } from "@/features/i18n";

// Nav order; `group` opens a labelled section in the sidebar.
const TABS = [
  { id: "general", label: "tabGeneral", description: "tabGeneralDesc", icon: GlobeIcon, group: "settingsGroupApp" },
  { id: "quick", label: "tabQuick", description: "tabQuickDesc", icon: ZapIcon },
  { id: "receipt", label: "tabReceipt", description: "tabReceiptDesc", icon: ReceiptIcon },
  // Providers and CLI agents are one page: both answer "where do the models
  // in the chat box come from", and split across two tabs the same key had
  // two homes.
  { id: "models", label: "tabModels", description: "tabModelsDesc", icon: SparklesIcon, group: "settingsGroupAi" },
  { id: "instructions", label: "tabInstructions", description: "tabInstructionsDesc", icon: NotebookPenIcon },
  { id: "skills", label: "tabSkills", description: "tabSkillsDesc", icon: BookOpenIcon },
  { id: "templates", label: "tabTemplates", description: "tabTemplatesDesc", icon: FileTextIcon },
  { id: "mcp", label: "tabMcp", description: "tabMcpDesc", lobeMcp: true as const, group: "settingsGroupWorkspace" },
  { id: "folders", label: "tabFolders", description: "tabFoldersDesc", icon: FolderIcon },
] as const satisfies readonly {
  id: string;
  label: TranslationKey;
  description: TranslationKey;
  group?: TranslationKey;
  [extra: string]: unknown;
}[];

type TabId = (typeof TABS)[number]["id"];

const TAB = cn(
  "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors",
  "hover:text-foreground",
  "data-active:text-foreground",
);

export default function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "general";
  const selectedIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const active = TABS[selectedIndex];

  const goTo = (index: number) => {
    const id = TABS[index]?.id ?? "general";
    setParams(id === "general" ? {} : { tab: id }, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <TabGroup selectedIndex={selectedIndex} onChange={goTo} className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        {/* Pinned while the section on the right scrolls (the app layout is the scroller). */}
        <aside className="flex w-full shrink-0 flex-col gap-6 lg:sticky lg:top-10 lg:w-56 xl:w-60">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t("settingsTitle")}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("settingsSubtitle")}
            </p>
          </header>

          <nav aria-label={t("settingsSections")} className="scroll-hidden -mx-1 overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0">
            {/* `inset-0`: without it the highlight collapses to a dot. */}
            <TabHighlight className="inset-0 rounded-lg bg-primary/15">
              <TabList className="relative flex min-w-min flex-row gap-0.5 lg:min-w-0 lg:flex-col">
                {TABS.map((item, index) => {
                  const Icon = "icon" in item ? item.icon : null;
                  const group = "group" in item ? item.group : null;
                  return (
                    <Fragment key={item.id}>
                      {group && (
                        <p
                          className={cn(
                            "hidden px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/80 uppercase lg:block",
                            index > 0 && "mt-3 border-t border-border/60 pt-4",
                          )}
                        >
                          {t(group)}
                        </p>
                      )}
                      <TabHighlightItem index={index} className="lg:w-full">
                        <Tab index={index} className={cn(TAB, "lg:justify-start")}>
                          {"lobeMcp" in item && item.lobeMcp ? (
                            <McpTabIcon />
                          ) : (
                            Icon && <Icon className="size-4 shrink-0" />
                          )}
                          <span className="flex min-w-0 flex-col items-start leading-tight">
                            <span className="truncate">{t(item.label)}</span>
                            <span className="hidden text-[11px] font-normal text-muted-foreground lg:block">
                              {t(item.description)}
                            </span>
                          </span>
                        </Tab>
                      </TabHighlightItem>
                    </Fragment>
                  );
                })}
              </TabList>
            </TabHighlight>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-6 flex flex-col gap-0.5 border-b border-border/60 pb-6 lg:hidden">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(active.label)}</p>
            <p className="text-sm text-muted-foreground">{t(active.description)}</p>
          </div>

          <TabPanels mode="layout">
            <TabPanel>
              <GeneralSettings />
            </TabPanel>
            <TabPanel>
              <QuickSettings />
            </TabPanel>
            <TabPanel>
              <ReceiptSettings />
            </TabPanel>
            <TabPanel>
              <ModelsSettings />
            </TabPanel>
            <TabPanel>
              <InstructionsSettings />
            </TabPanel>
            <TabPanel>
              <SkillsSettings />
            </TabPanel>
            <TabPanel>
              <TemplatesSettings />
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
