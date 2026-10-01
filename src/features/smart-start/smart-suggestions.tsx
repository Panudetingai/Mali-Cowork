import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requestCompose } from "@/features/command-palette";
import { useTranslation } from "@/features/i18n";
import { skillSlug, useInstructions } from "@/features/instructions";
import { useWorkspaceFiles } from "@/pages/chat/components/mention/use-workspace-files";
import { cn } from "@/lib/utils";
import {
  BarChart3Icon,
  BookIcon,
  CalendarRangeIcon,
  Code2Icon,
  FileTextIcon,
  FolderKanbanIcon,
  FolderTreeIcon,
  GlobeIcon,
  GraduationCapIcon,
  ImagesIcon,
  InfoIcon,
  LanguagesIcon,
  LightbulbIcon,
  ListTodoIcon,
  MailIcon,
  PaletteIcon,
  PenLineIcon,
  PresentationIcon,
  ScrollTextIcon,
  StampIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { chatIdeas, coworkIdeas, pickSuggestions, suggestTasks, type Suggestion } from "./suggestions";
import type { WorkMode } from "../opencode";

const ICONS: Record<Suggestion["icon"], typeof FileTextIcon> = {
  pdf: FileTextIcon,
  doc: ScrollTextIcon,
  sheet: BarChart3Icon,
  image: ImagesIcon,
  code: Code2Icon,
  notes: ListTodoIcon,
  tidy: FolderTreeIcon,
  slides: PresentationIcon,
  template: StampIcon,
  web: GlobeIcon,
  write: PenLineIcon,
  design: PaletteIcon,
  mail: MailIcon,
  plan: CalendarRangeIcon,
  translate: LanguagesIcon,
  idea: LightbulbIcon,
  learn: GraduationCapIcon,
};

const CARD_COUNT = 3;
/** Brief placeholder so tab switches feel like Cowork folder scan. */
const CHAT_SHELL_MS = 140;

/** One card on a phone-narrow window, two on a medium one, three from `lg` up. */
const SUGGESTION_GRID =
  "grid w-full min-w-0 shrink-0 grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4";

/** The cards past what the grid shows at this width. */
function hiddenAt(index: number) {
  return index === 1 ? "hidden sm:flex" : index >= 2 ? "hidden lg:flex" : "flex";
}

/** Match loaded suggestion cards so skeleton ↔ content does not jump. */
const SUGGESTION_CARD = "flex h-full min-h-24 w-full min-w-0 flex-col";

/** A short window keeps the cards to their title. */
const SHORT_WINDOW_HIDE = "[@media(max-height:720px)]:hidden";

export type SuggestionCardItem = {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onPick: () => void;
};

export function SuggestionCardsSkeleton({ count = CARD_COUNT, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(SUGGESTION_GRID, className)} aria-busy aria-label="Loading suggestions">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className={cn(SUGGESTION_CARD, hiddenAt(i))}>
          <CardHeader className="w-full">
            <Skeleton className="size-4 rounded-md" />
          </CardHeader>
          <CardContent className="flex w-full flex-1 flex-col gap-2.5">
            <Skeleton className="h-4 w-full max-w-none" />
            <Skeleton className="h-3 w-full max-w-none" />
            <Skeleton className="h-3 w-full max-w-none" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Empty-state suggestion cards. `motionKey` changes re-run enter animation and reshuffle. */
export function AnimatedSuggestionCards({
  items,
  className,
  motionKey,
  interactive,
}: {
  items: SuggestionCardItem[];
  className?: string;
  motionKey: string;
  interactive?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  if (items.length === 0) return null;

  return (
    <div className={cn(SUGGESTION_GRID, className)}>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <motion.button
            key={`${motionKey}-${item.id}`}
            type="button"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0.12 : 0.35,
              ease: "easeOut",
              delay: reduceMotion ? 0 : i * 0.1,
            }}
            onClick={item.onPick}
            className={cn(
              "h-full w-full min-w-0 flex-col gap-1.5 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              hiddenAt(i),
            )}
          >
            <Card className={cn(SUGGESTION_CARD, interactive && "transition-colors hover:bg-accent/40")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardTitle className="line-clamp-2 text-sm font-semibold">{item.title}</CardTitle>
                <CardDescription className={cn("line-clamp-3 text-sm text-muted-foreground", SHORT_WINDOW_HIDE)}>
                  {item.description}
                </CardDescription>
              </CardContent>
            </Card>
          </motion.button>
        );
      })}
    </div>
  );
}

type ChatSuggestionDef = {
  id: string;
  icon: ComponentType<{ className?: string }>;
  titleKey: "chatSuggestionHowTitle" | "chatSuggestionProjectTitle" | "chatSuggestionAboutTitle";
  descriptionKey:
    | "chatSuggestionHowDescription"
    | "chatSuggestionProjectDescription"
    | "chatSuggestionAboutDescription";
  promptKey: "chatSuggestionHowPrompt" | "chatSuggestionProjectPrompt" | "chatSuggestionAboutPrompt";
};

const CHAT_SUGGESTIONS: ChatSuggestionDef[] = [
  {
    id: "how",
    icon: BookIcon,
    titleKey: "chatSuggestionHowTitle",
    descriptionKey: "chatSuggestionHowDescription",
    promptKey: "chatSuggestionHowPrompt",
  },
  {
    id: "project",
    icon: FolderKanbanIcon,
    titleKey: "chatSuggestionProjectTitle",
    descriptionKey: "chatSuggestionProjectDescription",
    promptKey: "chatSuggestionProjectPrompt",
  },
  {
    id: "about",
    icon: InfoIcon,
    titleKey: "chatSuggestionAboutTitle",
    descriptionKey: "chatSuggestionAboutDescription",
    promptKey: "chatSuggestionAboutPrompt",
  },
];

/**
 * Chat + Cowork empty-state cards. Cowork reads folder names; Chat uses fixed prompts.
 * Shows skeleton while Cowork scans the folder or during a short shell on each `motionKey` change.
 */
export function SmartSuggestions({
  folder,
  className,
  mode,
  motionKey,
}: {
  folder?: string;
  className?: string;
  mode: WorkMode;
  motionKey: string;
}) {
  const { t, lang } = useTranslation();
  const { entries, loading: folderLoading } = useWorkspaceFiles(mode === "cowork" ? folder : undefined);
  const { skills } = useInstructions();
  const [shellReady, setShellReady] = useState(false);

  useEffect(() => {
    setShellReady(false);
    const id = window.setTimeout(() => setShellReady(true), mode === "chat" ? CHAT_SHELL_MS : 0);
    return () => window.clearTimeout(id);
  }, [motionKey, mode]);

  const coworkLoading = mode === "cowork" && (!!folder && folderLoading);
  const loading = !shellReady || coworkLoading;

  const items = useMemo((): SuggestionCardItem[] => {
    if (loading) return [];

    const language = lang === "th" ? "th" : "en";
    const card = (idea: Suggestion): SuggestionCardItem => ({
      id: idea.id,
      title: idea.title,
      description: idea.prompt,
      icon: ICONS[idea.icon],
      onPick: () => requestCompose({ text: idea.prompt }),
    });

    if (mode === "chat") {
      const own = CHAT_SUGGESTIONS.map((def) => ({
        id: def.id,
        title: t(def.titleKey),
        description: t(def.descriptionKey),
        icon: def.icon,
        onPick: () => requestCompose({ text: t(def.promptKey) }),
      }));
      return pickSuggestions([], [...own, ...chatIdeas(language).map(card)], CARD_COUNT);
    }

    const files = folder ? entries.filter((e) => !e.isDirectory).map((e) => e.rel) : [];
    const usable = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
    const ideas = suggestTasks(files, language, 8).filter((idea) => !idea.skill || usable.has(idea.skill));
    // What the folder holds leads; the document templates and general ideas fill in at random.
    const fromFolder = ideas.filter((idea) => !idea.skill);
    const general = [...ideas.filter((idea) => idea.skill), ...coworkIdeas(language)];
    return pickSuggestions(fromFolder, general, CARD_COUNT)
      .map((idea: Suggestion) => ({
        id: idea.id,
        title: idea.title,
        description: idea.prompt,
        icon: ICONS[idea.icon],
        onPick: () => {
          const skill = idea.skill ? skills.find((s) => s.name === idea.skill) : undefined;
          requestCompose({ text: idea.prompt, skill: skill ? skillSlug(skill) : undefined });
        },
      }));
  }, [loading, mode, folder, entries, skills, lang, t, motionKey]);

  if (loading) return <SuggestionCardsSkeleton count={CARD_COUNT} className={cn("w-full", className)} />;
  if (items.length === 0) return null;

  return (
    <AnimatedSuggestionCards
      items={items}
      className={cn("w-full", className)}
      motionKey={motionKey}
      interactive={mode === "cowork"}
    />
  );
}
