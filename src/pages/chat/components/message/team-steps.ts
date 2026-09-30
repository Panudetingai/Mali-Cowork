import type { ActivityItem } from "../../types";

/**
 * One hand-off in team mode, as the agent streams it (see `step_id` in
 * `src-tauri/src/agent/team.rs`): `team:<bot>:<call>` is the lead's step that
 * becomes the bot's report, `…:brief` the lead's brief, `…:step:<id>` what
 * the bot ran.
 */
export type TeamHandoff = {
  type: "team";
  key: string;
  teammateId: string;
  brief?: ActivityItem;
  report?: ActivityItem;
  steps: ActivityItem[];
};

export type StepGroup = { type: "steps"; steps: ActivityItem[] } | TeamHandoff;

function parse(id: string | undefined) {
  if (!id?.startsWith("team:")) return undefined;
  const [teammateId, call, part] = id.slice("team:".length).split(":");
  if (!teammateId || !call) return undefined;
  return { teammateId, key: `${teammateId}:${call}`, part: part ?? "" };
}

/** Steps as they'll show: plain runs of steps, and each hand-off as one conversation where it began. */
export function groupTeamSteps(steps: ActivityItem[]): StepGroup[] {
  const groups: StepGroup[] = [];
  const handoffs = new Map<string, TeamHandoff>();
  for (const step of steps) {
    const team = parse(step.id);
    if (!team) {
      const last = groups.at(-1);
      if (last?.type === "steps") last.steps.push(step);
      else groups.push({ type: "steps", steps: [step] });
      continue;
    }
    let handoff = handoffs.get(team.key);
    if (!handoff) {
      handoff = { type: "team", key: team.key, teammateId: team.teammateId, steps: [] };
      handoffs.set(team.key, handoff);
      groups.push(handoff);
    }
    if (team.part === "") handoff.report = step;
    else if (team.part === "brief") handoff.brief = step;
    else handoff.steps.push(step);
  }
  return groups;
}

/** The bot's report without the "Report from X:" the lead reads. */
export function reportText(report: ActivityItem | undefined) {
  return (report?.detail ?? "").replace(/^Report from [^\n]*:\n\n/, "").trim();
}
