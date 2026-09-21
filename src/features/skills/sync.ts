import { saveSkill, subscribeToInstructions, toSkillFile, type Skill } from "@/features/instructions";
import { saveProjectSkill, subscribeToProjects } from "@/features/projects";
import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";
import { everySkill, skillsDir, takenSlugs, uniqueSlug } from "./install";

/**
 * Keeping the library on disk in step with the app.
 *
 * Every skill gets a folder the agent can read. Editing one rewrites its
 * SKILL.md and leaves the files it came with alone; deleting it takes the
 * folder away. Turning a skill off keeps the folder — the agent is simply
 * not told about it — so switching it back on doesn't cost it its scripts.
 */

/** The slugs this app has written, so sync only ever removes its own work. */
const written = createStore<string[]>([], {
  key: "mali_skills_on_disk",
  revive: (value) => (Array.isArray(value) ? value.filter((s) => typeof s === "string") : []),
});

/** Where the library lives; read once, since it never moves. */
let dirPromise: Promise<string> | undefined;

export function libraryDir() {
  dirPromise ??= skillsDir().catch((error) => {
    dirPromise = undefined;
    throw error;
  });
  return dirPromise;
}

/**
 * The folder the agent needs to read skills, granted read-only alongside the
 * folders the user picked. Returns nothing if the library can't be reached,
 * so a prompt is never blocked by it.
 */
export async function skillsGrant(): Promise<{ path: string; access: "read" } | null> {
  try {
    return { path: await libraryDir(), access: "read" };
  } catch {
    return null;
  }
}

/** A skill with something to write: the rest is a half-finished draft. */
function usable(skill: Skill) {
  return !!skill.name.trim() && !!skill.instructions.trim();
}

/**
 * Write the library to disk and remove the folders of skills that are gone.
 * Skills without a folder name yet get one, which is saved back to the store.
 */
export async function syncSkills(): Promise<void> {
  // A project's skills get folders too: a chat in that project is told about
  // them the same way, so they have to be there to read.
  const library = everySkill().filter(({ skill }) => usable(skill));

  // A skill imported before it had a folder picks one that is still free.
  const taken = new Set(takenSlugs());
  const entries = library.map(({ skill, projectId }) => {
    let slug = skill.install?.slug;
    if (!slug) {
      slug = uniqueSlug(skill, taken);
      taken.add(slug);
    }
    return { skill, slug, projectId };
  });

  const keep = new Set(entries.map((e) => e.slug));
  const remove = written.get().filter((slug) => !keep.has(slug));

  const installed = await invoke<{ slug: string; dir: string; files: string[] }[]>("skills_sync", {
    skills: entries.map(({ skill, slug }) => ({ slug, content: toSkillFile(skill) })),
    remove,
  });

  written.set([...keep]);

  // Record where each one landed, so the system prompt can point at it.
  const at = new Date().toISOString();
  for (const { skill, slug, projectId } of entries) {
    const found = installed.find((i) => i.slug === slug);
    if (!found) continue;
    const before = skill.install;
    const same =
      before?.dir === found.dir &&
      before.slug === slug &&
      before.files.join("\u0000") === found.files.join("\u0000");
    if (same) continue;
    const next = { ...skill, install: { slug, dir: found.dir, files: found.files, at } };
    if (projectId) saveProjectSkill(projectId, next);
    else saveSkill(next);
  }
}

/**
 * Sync now and on every change to the library, coalescing the bursts that a
 * multi-skill import produces. Returns a function that stops watching.
 */
export function watchSkills(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await syncSkills();
    } catch (error) {
      // The library is a convenience; a chat still works without it.
      console.warn("Couldn't sync the skill library", error);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 400);
  };

  schedule();
  const stop = subscribeToSkills(schedule);
  return () => {
    clearTimeout(timer);
    stop();
  };
}

/** Re-run when the skills themselves change, not when anything else does. */
function subscribeToSkills(listener: () => void) {
  let last = fingerprint();
  const onChange = () => {
    const next = fingerprint();
    if (next === last) return;
    last = next;
    listener();
  };
  const stops = [subscribeToInstructions(onChange), subscribeToProjects(onChange)];
  return () => stops.forEach((stop) => stop());
}

/** Changes worth a rewrite: a skill's text, not an unrelated setting. */
function fingerprint() {
  return everySkill()
    .filter(({ skill }) => usable(skill))
    .map(({ skill: k }) => `${k.id}:${k.name}:${k.description}:${k.instructions}`)
    .join("|");
}
