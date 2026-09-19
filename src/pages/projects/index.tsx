import { Button } from "@/components/ui/button";
import { useChatSessions } from "@/features/chat-history";
import { createProject, useProjects } from "@/features/projects";
import { folderName } from "@/features/workspace";
import { EmptyState } from "@/pages/settings/ui";
import { FolderIcon, FolderKanbanIcon, MessageCircleIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EMPTY_PROJECT, ProjectDialog } from "./project-dialog";
import type { ProjectDraft } from "@/features/projects";

export default function ProjectsPage() {
  const projects = useProjects();
  const sessions = useChatSessions();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ProjectDraft | null>(null);

  const chatCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) if (s.projectId) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
    return counts;
  }, [sessions]);

  const sorted = useMemo(() => [...projects].sort((a, b) => b.updatedAt - a.updatedAt), [projects]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Group chats by what you’re working on. Each project has its own instructions, skills and folder.
          </p>
        </div>
        <Button className="gap-1.5 self-start sm:self-auto" onClick={() => setDraft(EMPTY_PROJECT)}>
          <PlusIcon className="size-4" />
          New project
        </Button>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<FolderKanbanIcon />}
          title="No projects yet"
          description="Create one for a client, a report or a codebase, then start chats inside it."
          action={
            <Button size="sm" className="gap-1.5" onClick={() => setDraft(EMPTY_PROJECT)}>
              <PlusIcon className="size-4" />
              New project
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((project) => {
            const chats = chatCounts.get(project.id) ?? 0;
            return (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  className="flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-border hover:bg-muted/20"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-400">
                    <FolderKanbanIcon className="size-[1.125rem]" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-[15px] font-semibold tracking-tight">{project.name}</span>
                    <span className="line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
                      {project.description || "No description"}
                    </span>
                  </span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MessageCircleIcon className="size-3.5" />
                      {chats} chat{chats === 1 ? "" : "s"}
                    </span>
                    {project.skills.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <SparklesIcon className="size-3.5" />
                        {project.skills.length} skill{project.skills.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {project.folder && (
                      <span className="inline-flex min-w-0 items-center gap-1" title={project.folder}>
                        <FolderIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{folderName(project.folder)}</span>
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <ProjectDialog
        draft={draft}
        onSave={(next) => navigate(`/projects/${createProject(next).id}`)}
        onClose={() => setDraft(null)}
      />
    </div>
  );
}
