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
  Code2Icon,
  FileTextIcon,
  FolderKanbanIcon,
  FolderTreeIcon,
  ImagesIcon,
  InfoIcon,
  ListTodoIcon,
  PresentationIcon,
  ScrollTextIcon,
  StampIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { suggestTasks, type Suggestion } from "./suggestions";
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
};

const CARD_COUNT = 3;
/** Brief placeholder so tab switches feel like Cowork folder scan. */
const CHAT_SHELL_MS = 140;

const SUGGESTION_GRID =
  "grid w-full min-w-0 shrink-0 grid-cols-3 items-stretch gap-4";

/** Match loaded suggestion cards so skeleton ↔ content does not jump. */
const SUGGESTION_CARD = "flex h-full min-h-28 w-full min-w-0 flex-col";

export type SuggestionCardItem = {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onPick: () => void;
};

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function SuggestionCardsSkeleton({ count = CARD_COUNT, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(SUGGESTION_GRID, className)} aria-busy aria-label="Loading suggestions">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className={SUGGESTION_CARD}>
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
            className="flex h-full min-w-0 w-full flex-col gap-1.5 rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Card className={cn(SUGGESTION_CARD, interactive && "transition-colors hover:bg-accent/40")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardTitle
                  className={cn("text-sm font-semibold", !interactive && "whitespace-nowrap")}
                >
                  {item.title}
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">{item.description}</CardDescription>
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

    if (mode === "chat") {
      const pool = CHAT_SUGGESTIONS.map((def) => ({
        id: def.id,
        title: t(def.titleKey),
        description: t(def.descriptionKey),
        icon: def.icon,
        onPick: () => requestCompose({ text: t(def.promptKey) }),
      }));
      return shuffle(pool).slice(0, CARD_COUNT);
    }

    if (!folder) return [];
    const files = entries.filter((e) => !e.isDirectory).map((e) => e.rel);
    const usable = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
    const ideas = suggestTasks(files, lang === "th" ? "th" : "en", 8)
      .filter((idea) => !idea.skill || usable.has(idea.skill));
    return shuffle(ideas)
      .slice(0, CARD_COUNT)
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
