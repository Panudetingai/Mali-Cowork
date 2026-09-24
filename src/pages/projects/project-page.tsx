import { ConfirmDialog, type ConfirmRequest } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sessionMode, useChatRuns, useChatSessions } from "@/features/chat-history";
import {
  deleteProject,
  deleteProjectSkill,
  editProject,
  getProject,
  newProjectChatUrl,
  saveProjectSkill,
  toggleProjectSkill,
  updateProject,
  useProjects,
  type ProjectDraft,
} from "@/features/projects";
import { folderName } from "@/features/workspace";
import { OutputsList } from "@/features/work-receipt";
import { SkillsManager } from "@/pages/settings/skills/skills-manager";
import { GroupLabel, SettingsSection } from "@/pages/settings/ui";
import {
  ChevronLeftIcon,
  FolderIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  PencilIcon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ProjectDialog } from "./project-dialog";

function formatWhen(time: number) {
  const date = new Date(time);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ProjectPage() {
  const { projectId } = useParams();
  useProjects(); // re-render on edits
  const project = getProject(projectId);
  const sessions = useChatSessions();
  const runs = useChatRuns();
  const navigate = useNavigate();
  const instructionsId = useId();
  const [editing, setEditing] = useState<ProjectDraft | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest>();

  const chats = useMemo(
    () => sessions.filter((s) => s.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, projectId],
  );

  if (!project) return <Navigate to="/projects" replace />;

  const askDelete = () =>
    setConfirm({
      title: "Delete project?",
      description: (
        <>
          “{project.name}”, its instructions and its {project.skills.length} skill
          {project.skills.length === 1 ? "" : "s"} will be removed.{" "}
          {chats.length > 0 && `Its ${chats.length} chat${chats.length === 1 ? "" : "s"} stay in your history.`}
        </>
      ),
      confirmLabel: "Delete project",
      destructive: true,
      onConfirm: () => {
        deleteProject(project.id);
        navigate("/projects", { replace: true });
      },
    });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-10">
      <header className="flex flex-col gap-4">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          Projects
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            {project.description && (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{project.description}</p>
            )}
            {project.folder && (
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={project.folder}>
                <FolderIcon className="size-3.5 shrink-0" />
                <span className="truncate">{project.folder}</span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button className="gap-1.5" onClick={() => navigate(newProjectChatUrl(project, "chat"))}>
              <SquarePenIcon className="size-4" />
              New chat
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              title={project.folder ? `Works in ${folderName(project.folder)}` : undefined}
              onClick={() => navigate(newProjectChatUrl(project, "cowork"))}
            >
              <SparklesIcon className="size-4" />
              New Cowork task
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Edit project"
              onClick={() =>
                setEditing({
                  name: project.name,
                  description: project.description,
                  instructions: project.instructions,
                  folder: project.folder,
                })
              }
            >
              <PencilIcon className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete project"
              className="text-muted-foreground hover:text-destructive"
              onClick={askDelete}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <SettingsSection>
          <GroupLabel>Chats</GroupLabel>
          {chats.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/80 bg-muted/15 p-6 text-center text-sm text-muted-foreground">
              No chats yet. Start one above, or move a chat here from its menu in the sidebar.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <Link
                    to={`/chat/${chat.id}`}
                    className="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                  >
                    {runs[chat.id] ? (
                      <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-sky-500" />
                    ) : sessionMode(chat) === "cowork" ? (
                      <SparklesIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <MessageCircleIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{chat.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(chat.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        <div className="flex min-w-0 flex-col gap-10">
          <SettingsSection>
            <label htmlFor={instructionsId} className="text-sm font-medium">
              Project instructions
            </label>
            <Textarea
              id={instructionsId}
              value={project.instructions}
              onChange={(e) => updateProject(project.id, (p) => ({ ...p, instructions: e.target.value }))}
              placeholder={"What every chat in this project should know: goals, audience, sources, tone…"}
              className="min-h-32 resize-y rounded-xl text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Saved automatically. Added on top of your custom instructions in Settings.
            </p>
          </SettingsSection>

          <SettingsSection>
            <GroupLabel>Project skills</GroupLabel>
            <p className="text-sm text-muted-foreground">
              Only chats in this project use these, together with your skills from Settings.
            </p>
            <SkillsManager
              skills={project.skills}
              onSave={(skill) => saveProjectSkill(project.id, skill)}
              onToggle={(id, enabled) => toggleProjectSkill(project.id, id, enabled)}
              onDelete={(id) => deleteProjectSkill(project.id, id)}
            />
          </SettingsSection>

          <SettingsSection className="min-h-[16rem]">
            <GroupLabel>Outputs</GroupLabel>
            <OutputsList
              query={{ projectId: project.id }}
              empty={
                <p className="rounded-2xl border border-dashed border-border/80 bg-muted/15 p-6 text-center text-sm text-muted-foreground">
                  No files created by Cowork in this project yet.
                </p>
              }
            />
          </SettingsSection>
        </div>
      </div>

      <ProjectDialog
        draft={editing}
        editing
        onSave={(draft) => editProject(project.id, draft)}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(undefined)} />
    </div>
  );
}
