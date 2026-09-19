import { generateStream, runModelIdFor } from "@/pages/chat/api/router";
import { loadSelectedModelId } from "@/pages/chat/models";
import { gitApi } from "./api";

const INSTRUCTIONS = `Write a git commit message for the changes below.

- Match the language and style of the recent commit subjects when there are some; otherwise write in English, imperative mood ("Add…", "Fix…").
- First line: a summary of at most 72 characters, no trailing period.
- Add a blank line and a short body only when the why isn't obvious from the summary.
- Reply with the commit message only: no quotes, no code fences, no explanation.`;

/**
 * Ask the model picked for Chat mode to describe the staged changes (all
 * changes when nothing is staged).
 */
export async function writeCommitMessage(folder: string): Promise<string> {
  const context = await gitApi.commitContext(folder);
  if (!context.diff.trim()) throw new Error("There are no changes to describe.");
  const recent = context.recentSubjects.length
    ? `Recent commit subjects:\n${context.recentSubjects.map((s) => `- ${s}`).join("\n")}\n\n`
    : "";
  let text = "";
  let failure: string | undefined;
  await generateStream(
    {
      prompt: `${INSTRUCTIONS}\n\n${recent}<changes>\n${context.diff}\n</changes>`,
      modelId: runModelIdFor(loadSelectedModelId("chat")),
      mode: "chat",
      runId: `git-commit-${crypto.randomUUID()}`,
      history: [],
    },
    {
      onChunk: (chunk) => {
        text += chunk;
      },
      onDone: () => {},
      onError: (message) => {
        failure = message;
      },
    },
  );
  if (failure) throw new Error(failure);
  return cleanMessage(text);
}

/** Models sometimes wrap the message in a fence or quotes anyway. */
export function cleanMessage(raw: string) {
  let text = raw.trim();
  const fence = text.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  if (/^(["'`]).*\1$/s.test(text)) text = text.slice(1, -1).trim();
  return text;
}
