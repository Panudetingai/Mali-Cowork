import type { ChatSession } from "@/features/chat-history";
import { buildWorkReceipt, DEFAULT_TIME_SAVED_RATES, estimateMinutesSaved } from "./receipt";
import type { TimeSavedRates, WeeklyRecap } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Monday 00:00 local time of the week `at` falls in. */
export function startOfWeek(at: number | Date = Date.now()) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function top<K>(counts: Map<K, number>, limit: number) {
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Sums one week of Cowork turns. Local only — nothing leaves the device. */
export function buildWeeklyRecap(
  sessions: ChatSession[],
  weekStart = startOfWeek(),
  rates: TimeSavedRates = DEFAULT_TIME_SAVED_RATES,
): WeeklyRecap {
  // Adding 7 days by date, not by ms, keeps DST weeks aligned to Monday.
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  const weekEnd = end.getTime() || weekStart + 7 * DAY;
  const recap: WeeklyRecap = {
    weekStart,
    weekEnd,
    tasks: 0,
    filesCreated: 0,
    filesModified: 0,
    commands: 0,
    agentMs: 0,
    totalTokens: 0,
    cost: 0,
    minutesSaved: 0,
    topProjects: [],
    topModels: [],
  };
  const projects = new Map<string | undefined, number>();
  const models = new Map<string, number>();

  for (const session of sessions) {
    for (const message of session.messages) {
      // Replies saved before messages kept their time: the chat's last update,
      // as Outputs does, rather than leaving them out of every week.
      const at = message.createdAt ?? session.updatedAt;
      if (at === undefined || at < weekStart || at >= weekEnd) continue;
      const receipt = buildWorkReceipt(session, message);
      if (!receipt) continue;
      recap.tasks += 1;
      recap.agentMs += receipt.durationMs ?? 0;
      recap.cost += receipt.usage?.cost ?? 0;
      recap.totalTokens += receipt.usage?.totalTokens ?? 0;
      if (receipt.state === "applied") {
        recap.filesCreated += receipt.files.added;
        recap.filesModified += receipt.files.modified;
        recap.commands += receipt.commands.length;
      }
      recap.minutesSaved += estimateMinutesSaved(receipt, rates);
      projects.set(session.projectId, (projects.get(session.projectId) ?? 0) + 1);
      const model = receipt.modelId?.trim() || "unknown";
      models.set(model, (models.get(model) ?? 0) + 1);
    }
  }

  recap.topProjects = top(projects, 3).map(([projectId, tasks]) => ({ projectId, tasks }));
  recap.topModels = top(models, 3).map(([modelId, tasks]) => ({ modelId, tasks }));
  return recap;
}
