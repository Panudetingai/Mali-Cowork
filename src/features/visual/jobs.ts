/**
 * Pictures and clips being made. A job lives here, not in the page, so it
 * shows in the gallery the moment it's sent, keeps going when the user
 * leaves the page, and several can run at once.
 */
import { mediaGenerateStream, type MediaRequest } from "@/features/media";
import { createStore } from "@/lib/local-store";
import { addVisualItems } from "./store";
import type { MediaKind } from "./types";

export type VisualJob = {
  id: string;
  kind: MediaKind;
  prompt: string;
  modelId: string;
  modelName: string;
  /** How many files were asked for, for the placeholders. */
  count: number;
  startedAt: number;
  /** What the backend is doing now ("Making a picture with …"). */
  step?: string;
  error?: string;
  /** Kept to run the same request again after an error. */
  request: MediaRequest;
};

const jobs = createStore<VisualJob[]>([]);

export const useVisualJobs = jobs.use;

const patch = (id: string, fn: (job: VisualJob) => VisualJob) =>
  jobs.set((prev) => prev.map((j) => (j.id === id ? fn(j) : j)));

export function dismissVisualJob(id: string) {
  jobs.set((prev) => prev.filter((j) => j.id !== id));
}

/** Paths in the reply's ```media blocks. */
function pathsIn(text: string) {
  return [...text.matchAll(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(([, path]) => JSON.parse(`"${path}"`) as string);
}

function run(job: VisualJob) {
  const made: string[] = [];
  let settled = false;
  const finish = (error?: string) => {
    if (settled) return;
    settled = true;
    if (made.length > 0) {
      addVisualItems(
        made.map((path, at) => ({
          id: `${job.id}-${at}`,
          kind: job.kind,
          path,
          prompt: job.prompt,
          modelId: job.modelId,
          createdAt: Date.now(),
        })),
      );
    }
    if (error || made.length === 0) {
      patch(job.id, (j) => ({ ...j, error: error ?? `No ${job.kind === "image" ? "picture" : "video"} came back.` }));
    } else {
      dismissVisualJob(job.id);
    }
  };

  mediaGenerateStream(job.request, {
    onChunk: (chunk) => made.push(...pathsIn(chunk)),
    onActivity: (activity) => !activity.done && patch(job.id, (j) => ({ ...j, step: activity.title })),
    onError: (message) => finish(message),
    onDone: () => finish(),
  })
    // The command returning is the end too: a stream that never said `done`
    // must not leave the card spinning.
    .then(() => finish())
    .catch((error) => finish(error instanceof Error ? error.message : String(error)));
}

export function startVisualJob(input: Omit<VisualJob, "id" | "startedAt">) {
  const job: VisualJob = { ...input, id: crypto.randomUUID(), startedAt: Date.now() };
  jobs.set((prev) => [job, ...prev]);
  run(job);
  return job.id;
}

/** Run a failed job again, in place. */
export function retryVisualJob(id: string) {
  const job = jobs.get().find((j) => j.id === id);
  if (!job) return;
  const fresh: VisualJob = { ...job, startedAt: Date.now(), error: undefined, step: undefined };
  patch(id, () => fresh);
  run(fresh);
}
