import type { WorkMode } from "@/features/opencode";
import type { Project } from "@/features/projects";
import { cn } from "@/lib/utils";
import { FolderKanbanIcon } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

const MODE_LABEL: Record<WorkMode, string> = {
  chat: "Chat",
  cowork: "Cowork",
};

const TAIL: Record<WorkMode, string> = {
  chat: "what would you like to talk about today?",
  cowork: "what would you like to create today?",
};

/** Empty chat headline — centered above the composer, like the visual gallery welcome. */
export default function ChatTitle({ mode, project }: { mode: WorkMode; project?: Project }) {
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

  return (
    <motion.div
      key={mode}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-xl px-4 text-center"
    >
      <p className="text-2xl leading-relaxed text-muted-foreground sm:text-3xl">
        Welcome to{" "}
        <motion.span
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="font-semibold text-foreground"
        >
          {MODE_LABEL[mode]}
        </motion.span>
        {" — "}
        {TAIL[mode]}
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
