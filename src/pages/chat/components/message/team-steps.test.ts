import { expect, test } from "bun:test";
import type { ActivityItem } from "../../types";
import { groupTeamSteps, reportText } from "./team-steps";

const step = (id: string, over: Partial<ActivityItem> = {}): ActivityItem => ({ id, kind: "tool", title: id, done: true, ...over });

test("a hand-off becomes one conversation where it began", () => {
  const groups = groupTeamSteps([
    step("c1", { title: "Read: a.txt" }),
    step("team:momo:call_1", { done: false, title: "Team: Momo" }),
    step("team:momo:call_1:brief", { detail: "Job from the lead: make a post" }),
    step("team:momo:call_1:step:call_x", { title: "canva_create" }),
    step("c2", { title: "Update plan" }),
  ]);
  expect(groups.map((g) => g.type)).toEqual(["steps", "team", "steps"]);
  const handoff = groups[1];
  if (handoff.type !== "team") throw new Error();
  expect(handoff.teammateId).toBe("momo");
  expect(handoff.report?.title).toBe("Team: Momo");
  expect(handoff.brief?.detail).toContain("make a post");
  expect(handoff.steps.map((s) => s.title)).toEqual(["canva_create"]);
});

test("two hand-offs to the same bot stay apart", () => {
  const groups = groupTeamSteps([step("team:momo:a"), step("team:momo:b")]);
  expect(groups).toHaveLength(2);
});

test("the report drops the heading the lead reads", () => {
  expect(reportText(step("x", { detail: "Report from Momo:\n\nDone: https://canva/1" }))).toBe("Done: https://canva/1");
  expect(reportText(undefined)).toBe("");
});
