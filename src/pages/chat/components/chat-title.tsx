import { useTranslation } from "@/features/i18n";
import type { WorkMode } from "@/features/opencode";
import type { Project } from "@/features/projects";
import { cn } from "@/lib/utils";
import { FolderKanbanIcon, GhostIcon } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

/** Empty chat headline — centered above the composer, like the visual gallery welcome. */
export default function ChatTitle({
  mode,
  project,
  temporary,
}: {
  mode: WorkMode;
  project?: Project;
  temporary?: boolean;
}) {
  const { t } = useTranslation();

  if (project) {
    return (
      <motion.div
        key={project.id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex max-w-xl flex-col items-center gap-3 px-4 text-center"
      >
        <ProjectChip project={project} />
        <p className="text-2xl leading-relaxed text-muted-foreground sm:text-3xl">
          New chat in{" "}
          <span className="font-semibold text-foreground">{project.name}</span>
          {" — "}uses this project’s instructions and skills.
        </p>
      </motion.div>
    );
  }

  const modeLabel = mode === "chat" ? t("chatEmptyModeChat") : t("chatEmptyModeCowork");
  const tail = mode === "chat" ? t("chatEmptyTailChat") : t("chatEmptyTailCowork");

  return (
    <motion.div
      key={mode}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex max-w-xl flex-col items-center gap-3 px-4 text-center"
    >
      {temporary && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <GhostIcon className="size-3.5" />
          {t("temporaryChatHint")}
        </span>
      )}
      <p className="mb-32 text-2xl leading-relaxed text-muted-foreground sm:text-3xl">
        {t("chatEmptyWelcomePrefix")}{" "}
        <motion.span
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="font-semibold text-foreground"
        >
          {modeLabel}
        </motion.span>
        {" — "}
        {tail}
      </p>
    </motion.div>
  );
}

/** Which project a chat belongs to; opens the project. */
export function ProjectChip({ project, className }: { project: Project; className?: string }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className={cn(
        "inline-flex max-w-64 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <FolderKanbanIcon className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </Link>
  );
}
