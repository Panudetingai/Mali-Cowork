import { requestCompose } from "@/features/command-palette";
import { useTranslation } from "@/features/i18n";
import { skillSlug, useInstructions } from "@/features/instructions";
import { useWorkspaceFiles } from "@/pages/chat/components/mention/use-workspace-files";
import { cn } from "@/lib/utils";
import {
  BarChart3Icon,
  Code2Icon,
  FileTextIcon,
  FolderTreeIcon,
  ImagesIcon,
  ListTodoIcon,
  PresentationIcon,
  ScrollTextIcon,
  StampIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { suggestTasks, type Suggestion } from "./suggestions";

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

/** Task ideas for an empty Cowork chat, from the names of the files in its folder. Clicking one fills the chat box. */
export function SmartSuggestions({ folder, className }: { folder?: string; className?: string }) {
  const { lang } = useTranslation();
  const { entries, loading } = useWorkspaceFiles(folder);
  const { skills } = useInstructions();
  const reduceMotion = useReducedMotion();

  const ideas = useMemo(() => {
    if (!folder || loading) return [];
    const files = entries.filter((e) => !e.isDirectory).map((e) => e.rel);
    // A template card only makes sense while its skill is still switched on.
    const usable = new Set(skills.filter((s) => s.enabled).map((s) => s.name));
    return suggestTasks(files, lang === "th" ? "th" : "en", 6)
      .filter((idea) => !idea.skill || usable.has(idea.skill))
      .slice(0, 4);
  }, [folder, loading, entries, skills, lang]);

  if (ideas.length === 0) return null;

  const pick = (idea: Suggestion) => {
    const skill = idea.skill ? skills.find((s) => s.name === idea.skill) : undefined;
    requestCompose({ text: idea.prompt, skill: skill ? skillSlug(skill) : undefined });
  };

  return (
    <div className={cn("grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2", className)}>
      {ideas.map((idea, i) => {
        const Icon = ICONS[idea.icon];
        return (
          <motion.button
            key={idea.id}
            type="button"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: reduceMotion ? 0 : 0.05 * i }}
            onClick={() => pick(idea)}
            className="group flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground/80 group-hover:text-primary" />
            <span className="leading-snug">{idea.title}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
