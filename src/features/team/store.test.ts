import { expect, test } from "bun:test";
import { draftFromProposal, draftIssue, freeMascot, ownerOf, withTeammate, type Teammate, type TeammateDraft } from "./store";

const draft = (over: Partial<TeammateDraft> = {}): TeammateDraft => ({
  name: "Momo Designer",
  mascot: "momo",
  role: "Designs in Canva",
  instructions: "",
  modelId: "api:anthropic/claude-sonnet-5-5",
  skills: [],
  connectors: ["custom-canva"],
  tools: "read",
  onTeam: true,
  ...over,
});

const team = (): Teammate[] => withTeammate([], draft(), 1);

test("a connector belongs to one bot only", () => {
  const mates = team();
  const researcher = draft({ name: "Sora", role: "Research", mascot: "sora", connectors: ["custom-canva"] });
  expect(draftIssue(mates, researcher)).toContain("Momo Designer already owns that connector");
  expect(() => withTeammate(mates, researcher)).toThrow();
  expect(withTeammate(mates, { ...researcher, connectors: ["notion"] })).toHaveLength(2);
});

test("a skill belongs to one bot only", () => {
  const mates = withTeammate([], draft({ skills: ["brand"] }), 1);
  expect(draftIssue(mates, draft({ name: "Other", connectors: [], skills: ["brand"] }))).toContain("owns that skill");
});

test("editing a bot keeps its own connectors, id and origin", () => {
  const mates = team();
  const [momo] = mates;
  const edited = withTeammate(mates, { ...draft({ role: "Designs everything visual" }), id: momo.id }, 5);
  expect(edited).toHaveLength(1);
  expect(edited[0]).toMatchObject({ id: momo.id, role: "Designs everything visual", createdAt: 1, origin: "user" });
  expect(ownerOf(edited, "connectors", "custom-canva")?.id).toBe(momo.id);
  expect(ownerOf(edited, "connectors", "custom-canva", momo.id)).toBeUndefined();
});

test("a bot needs a name, a duty and a model, and a name of its own", () => {
  expect(draftIssue([], draft({ name: " " }))).toBeDefined();
  expect(draftIssue([], draft({ role: "" }))).toBeDefined();
  expect(draftIssue([], draft({ modelId: "" }))).toBeDefined();
  expect(draftIssue(team(), draft({ name: "momo designer", connectors: [] }))).toContain("already");
});

test("a duty that names a connector the bot lacks is caught", async () => {
  const { connectorsItNeeds } = await import("./store");
  const installed = [
    { id: "custom-canva", name: "Canva MCP" },
    { id: "notion", name: "Notion" },
  ];
  const momo = { role: "Designs posts in Canva.", instructions: "", connectors: [] as string[] };
  expect(connectorsItNeeds(momo, installed).map((c) => c.id)).toEqual(["custom-canva"]);
  expect(connectorsItNeeds({ ...momo, connectors: ["custom-canva"] }, installed)).toEqual([]);
});

test("a proposal leaves out connectors a bot owns and wears a free mascot", () => {
  const mates = team();
  const proposal = {
    id: "p1",
    name: "Canva Copywriter",
    role: "Writes captions",
    instructions: "",
    reason: "You write captions every week",
    tools: "read" as const,
    connectors: ["custom-canva", "notion"],
    at: 0,
  };
  const d = draftFromProposal(proposal, "api:openai/gpt-5", mates);
  expect(d.connectors).toEqual(["notion"]);
  expect(d.origin).toBe("lead");
  expect(d.mascot).not.toBe("momo");
  expect(freeMascot([])).toBe("mochi");
});

test("the notebook keeps ids across updates and leaves out what the user forgot", async () => {
  const { forgetInsight, getTeam, setNotebook } = await import("./store");
  setNotebook([
    { pattern: "Coffee promo posts", evidence: ["IG coffee", "TikTok coffee"], count: 2 },
    { pattern: "Weekly sales report", evidence: ["Sales wk1", "Sales wk2"], count: 2 },
  ]);
  const [coffee, sales] = getTeam().notebook;
  forgetInsight(sales.id);
  setNotebook([
    { pattern: "coffee promo posts", evidence: ["IG coffee", "TikTok coffee", "FB coffee"], count: 3 },
    { pattern: "Weekly sales report", evidence: ["Sales wk3"], count: 3 },
  ]);
  const notebook = getTeam().notebook;
  expect(notebook).toHaveLength(1);
  expect(notebook[0]).toMatchObject({ id: coffee.id, count: 3 });
});

test("a coaching changes how the bot works, and turning it down doesn't decline the bot", async () => {
  const { acceptProposal, addProposal, declineProposal, getTeam, saveTeammate } = await import("./store");
  saveTeammate(draft({ name: "Coached Momo", connectors: ["coach-canva"] }));
  const momo = getTeam().mates.find((m) => m.name === "Coached Momo")!;
  const coaching = { name: momo.name, role: momo.role, instructions: "1. Check the size first.", reason: "It made the wrong size.", tools: "read" as const, connectors: [], updates: momo.id };
  addProposal({ ...coaching, id: "c1" });
  declineProposal("c1");
  expect(getTeam().declined).not.toContain("Coached Momo");
  addProposal({ ...coaching, id: "c2" });
  acceptProposal("c2", "");
  expect(getTeam().mates.find((m) => m.id === momo.id)?.instructions).toBe("1. Check the size first.");
  expect(getTeam().proposals.find((p) => p.id === "c2")).toBeUndefined();
});

test("a CLI model coaches only when picked as the coach", async () => {
  const { modelCall } = await import("./payload");
  expect(modelCall("codex:gpt-5-codex")).toBeUndefined();
  expect(modelCall("codex:gpt-5-codex", { cli: true })?.cli).toMatchObject({ kind: "codex", request: { model: "gpt-5-codex" } });
  expect(modelCall("opencode:opencode/mimo-v2.6-flash-free", { cli: true })?.cli?.kind).toBe("opencode");
  expect(modelCall("api:anthropic/claude-sonnet-5-5")).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
});

test("a pattern is ready for a bot at three chats, and looked at once", async () => {
  const { markSuggested, readyPatterns, setNotebook } = await import("./store");
  setNotebook([
    { pattern: "Facebook posts", evidence: ["a", "b", "c"], count: 3 },
    { pattern: "Markdown files", evidence: ["a", "b"], count: 2 },
  ]);
  expect(readyPatterns().map((i) => i.pattern)).toEqual(["Facebook posts"]);
  markSuggested(["facebook posts "]);
  expect(readyPatterns()).toEqual([]);
});
