import {
  Tab,
  TabGroup,
  TabHighlight,
  TabHighlightItem,
  TabList,
} from "@/components/animate-ui/primitives/headless/tabs";
// Plain panels: the animated ones zoom and spring whenever a page changes height.
import { TabPanel, TabPanels } from "@headlessui/react";
import { cn } from "@/lib/utils";
import {
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  NotebookPenIcon,
  PanelTopIcon,
  ReceiptIcon,
  SparklesIcon,
  UsersIcon,
  AudioLinesIcon,
  Package,
  PuzzleIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { Fragment, type ReactNode } from "react";
import { FoldersSettings } from "./folders-settings";
import { GeneralSettings } from "./general-settings";
import { InstructionsSettings } from "./instructions-settings";
import { McpTabIcon } from "./mcp/mcp-icon";
import { McpSettings } from "./mcp/mcp-settings";
import { ModelsSettings } from "./models-settings";
import { NotchSettings } from "./notch-settings";
import { PluginsSettings } from "./plugins/plugins-settings";
import { ReceiptSettings } from "./receipt-settings";
import { SkillsSettings } from "./skills/skills-settings";
import { TeamSettings } from "./team/team-settings";
import { TemplatesSettings } from "./templates-settings";
import { VoiceSettings } from "./voice-settings";
import { useTranslation, type TranslationKey } from "@/features/i18n";
import { settingsPath, useSettingsRoute } from "./route";

// Nav order; `group` opens a labelled section in the sidebar,
// styled like the Integrations reference: UPPERCASE group, icon row,
// active row tinted, "?" hint for lost users.
const TABS = [
  { id: "general", label: "tabGeneral", description: "tabGeneralDesc", icon: GlobeIcon, group: "settingsGroupApp" },
  { id: "notch", label: "tabNotch", description: "tabNotchDesc", icon: PanelTopIcon },
  { id: "voice", label: "tabVoice", description: "tabVoiceDesc", icon: AudioLinesIcon },
  { id: "receipt", label: "tabReceipt", description: "tabReceiptDesc", icon: ReceiptIcon },
  // Providers and CLI agents are one page: both answer "where do the models
  // in the chat box come from", and split across two tabs the same key had
  // two homes.
  { id: "models", label: "tabModels", description: "tabModelsDesc", icon: SparklesIcon, group: "settingsGroupAi" },
  { id: "instructions", label: "tabInstructions", description: "tabInstructionsDesc", icon: NotebookPenIcon },
  { id: "skills", label: "tabSkills", description: "tabSkillsDesc", icon: Package },
  { id: "team", label: "tabTeam", description: "tabTeamDesc", icon: UsersIcon },
  { id: "templates", label: "tabTemplates", description: "tabTemplatesDesc", icon: FileTextIcon },
  { id: "plugins", label: "tabPlugins", description: "tabPluginsDesc", icon: PuzzleIcon },
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

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const route = useSettingsRoute();
  const tab: TabId = TABS.find((t) => t.id === route.tab)?.id ?? "general";
  const selectedIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const active = TABS[selectedIndex];

  const goTo = (index: number) => navigate(settingsPath(TABS[index]?.id ?? "general"));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <TabGroup selectedIndex={selectedIndex} onChange={goTo} className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left nav: back link, UPPERCASE groups, icon rows, tinted active row. */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-8 lg:w-60 xl:w-64">
          <h1 className="px-2.5 text-[15px] font-semibold tracking-tight">{t("settingsTitle")}</h1>

          <nav aria-label={t("settingsSections")} className="scroll-hidden -mx-1 overflow-x-auto px-1 lg:mx-0 lg:overflow-visible lg:px-0">
            <TabHighlight className="inset-0 rounded-lg bg-primary/15">
              <TabList className="relative flex min-w-min flex-row gap-0.5 lg:min-w-0 lg:flex-col lg:gap-0.5">
                {TABS.map((item, index) => {
                  const Icon = "icon" in item ? item.icon : null;
                  const group = "group" in item ? item.group : null;
                  const isActive = index === selectedIndex;
                  return (
                    <Fragment key={item.id}>
                      {group && (
                        <p
                          className={cn(
                            "hidden px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground/80 uppercase lg:block",
                            index > 0 && "mt-3",
                          )}
                        >
                          {t(group)}
                        </p>
                      )}
                      <TabHighlightItem index={index} className="lg:w-full">
                        <Tab
                          index={index}
                          title={t(item.description)}
                          // The open section again: out of its sub-page.
                          onClick={() => isActive && route.sub && goTo(index)}
                          className={cn(
                            "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors",
                            isActive
                              ? "text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          {"lobeMcp" in item && item.lobeMcp ? (
                            <McpTabIcon />
                          ) : (
                            Icon && <Icon className="size-4 shrink-0" />
                          )}
                          <span className="flex-1 truncate">{t(item.label)}</span>
                        </Tab>
                      </TabHighlightItem>
                    </Fragment>
                  );
                })}
              </TabList>
            </TabHighlight>
          </nav>
        </aside>

        {/* Right content — separated by a divider like the reference. */}
        <div className="min-w-0 flex-1 lg:border-l lg:border-border/60 lg:pl-8">
          <div className="mb-5 flex flex-col gap-1 lg:hidden">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(active.label)}</p>
            <p className="text-sm text-muted-foreground">{t(active.description)}</p>
          </div>

          <TabPanels>
            <TabPanel>
              <Enter>
                <GeneralSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <NotchSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <VoiceSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <ReceiptSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <ModelsSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <InstructionsSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <SkillsSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <TeamSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <TemplatesSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <PluginsSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <McpSettings />
              </Enter>
            </TabPanel>
            <TabPanel>
              <Enter>
                <FoldersSettings />
              </Enter>
            </TabPanel>
          </TabPanels>
        </div>
      </TabGroup>
    </div>
  );
}

/** Each page slides in from the right as you switch to it — no zoom, no bounce. */
function Enter({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      // Nothing left behind once in: a transform would trap fixed and sticky parts inside.
      animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
      transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
    >
      {children}
    </motion.div>
  );
}
