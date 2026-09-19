import type { WorkMode } from "@/features/opencode";
import type { Project } from "@/features/projects";
import { FolderKanbanIcon } from "lucide-react";
import { Link } from "react-router-dom";

const COPY: Record<WorkMode, { title: string; subtitle: string }> = {
  chat: {
    title: "Welcome to Mali Cowork AI",
    subtitle: "Ask anything — Chat answers without touching your files.",
  },
  cowork: {
    title: "What should we work on?",
    subtitle: "Cowork reads and changes files in the folders you allow.",
  },
};

export default function ChatTitle({ mode, project }: { mode: WorkMode; project?: Project }) {
  const { title, subtitle } = COPY[mode];
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      {project && <ProjectChip project={project} />}
      <h1 className="text-2xl font-semibold">{project ? `New chat in ${project.name}` : title}</h1>
      <p className="text-sm text-muted-foreground">
        {project ? "Uses this project’s instructions and skills." : subtitle}
      </p>
    </div>
  );
}

/** Which project a chat belongs to; opens the project. */
export function ProjectChip({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="inline-flex max-w-64 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <FolderKanbanIcon className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </Link>
  );
}
