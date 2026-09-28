import { releaseProjectChats } from "@/features/chat-history";
import { saveOpencodeSettings, type WorkMode } from "@/features/opencode";
import type { ProjectContext, Skill } from "@/features/instructions";
import { syncToDatabase } from "@/lib/db-sync";
import { loadHistorySnapshot } from "@/lib/history-db";
import { createStore } from "@/lib/local-store";

/** A workspace that groups chats and gives them shared instructions and skills. */
export type Project = {
  id: string;
  name: string;
  /** One line about what the project is; shown in lists and given to the AI. */
  description: string;
  /** Added to the instructions of every chat in the project. */
  instructions: string;
  /** Cowork: the folder new chats in this project work in. */
  folder?: string;
  /** Skills only this project's chats use. */
  skills: Skill[];
  createdAt: number;
  updatedAt: number;
};

export type ProjectDraft = Pick<Project, "name" | "description" | "instructions" | "folder">;

const NAME_MAX = 80;

// Held in memory; saved to SQLite next to the chats.
const store = createStore<Project[]>([]);
const database = syncToDatabase(store, "projects", { throttleMs: 300 });

export const useProjects = store.use;
export const getProjects = store.get;
/** Write pending project changes now (before a relaunch). */
export const flushProjects = () => database.flush();
/** For code outside React, e.g. keeping project skills on disk in step. */
export const subscribeToProjects = store.subscribe;

export async function loadProjects() {
  try {
    const { projects } = await loadHistorySnapshot<unknown, Project>();
    const valid = projects.filter(isProject).map(withDefaults);
    database.start(valid);
    store.set(valid);
  } catch (error) {
    console.error("[projects] could not load projects", error);
  }
}

export function getProject(id: string | undefined) {
  return id ? store.get().find((p) => p.id === id) : undefined;
}

export function createProject(draft: ProjectDraft): Project {
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    ...clean(draft),
    skills: [],
    createdAt: now,
    updatedAt: now,
  };
  store.set((prev) => [project, ...prev]);
  return project;
}

export function updateProject(id: string, fn: (project: Project) => Project) {
  store.set((prev) =>
    prev.map((p) => (p.id === id ? { ...fn(p), id, updatedAt: Date.now() } : p)),
  );
}

export function editProject(id: string, draft: ProjectDraft) {
  updateProject(id, (p) => ({ ...p, ...clean(draft) }));
}

/** Delete a project; its chats stay, back in the plain history. */
export function deleteProject(id: string) {
  store.set((prev) => prev.filter((p) => p.id !== id));
  releaseProjectChats(id);
}

export function saveProjectSkill(projectId: string, skill: Omit<Skill, "id"> & { id?: string }) {
  const id = skill.id ?? crypto.randomUUID();
  updateProject(projectId, (p) => {
    const next = { ...skill, id };
    const exists = p.skills.some((k) => k.id === id);
    return { ...p, skills: exists ? p.skills.map((k) => (k.id === id ? next : k)) : [...p.skills, next] };
  });
  return id;
}

export function toggleProjectSkill(projectId: string, skillId: string, enabled: boolean) {
  updateProject(projectId, (p) => ({
    ...p,
    skills: p.skills.map((k) => (k.id === skillId ? { ...k, enabled } : k)),
  }));
}

export function deleteProjectSkill(projectId: string, skillId: string) {
  updateProject(projectId, (p) => ({ ...p, skills: p.skills.filter((k) => k.id !== skillId) }));
}

/**
 * Where a new chat in a project opens. Cowork chats start in the project's
 * folder: it becomes the default, just like picking it in the chat box.
 */
export function newProjectChatUrl(project: Project, mode: WorkMode) {
  if (mode === "cowork" && project.folder) saveOpencodeSettings({ cwd: project.folder });
  return `/?mode=${mode}&project=${project.id}`;
}

/** What the AI gets from a project (see `buildInstructions`). */
export function projectContext(project: Project | undefined): ProjectContext | undefined {
  if (!project) return undefined;
  return {
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    skills: project.skills,
  };
}

function clean(draft: ProjectDraft): ProjectDraft {
  return {
    name: draft.name.trim().slice(0, NAME_MAX) || "Untitled project",
    description: draft.description.trim(),
    instructions: draft.instructions,
    folder: draft.folder?.trim() || undefined,
  };
}

function isProject(value: unknown): value is Project {
  const p = value as Project;
  return !!p && typeof p.id === "string" && typeof p.name === "string";
}

function withDefaults(p: Project): Project {
  return {
    ...p,
    description: typeof p.description === "string" ? p.description : "",
    instructions: typeof p.instructions === "string" ? p.instructions : "",
    skills: Array.isArray(p.skills) ? p.skills : [],
  };
}
