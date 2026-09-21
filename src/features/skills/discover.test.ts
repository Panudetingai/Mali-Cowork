import { beforeEach, expect, mock, test } from "bun:test";

/** Stand in for the Tauri backend, counting what the UI actually asks for. */
let answer: (query: string) => { repos: unknown[]; remaining?: number; retryAfter?: number };
let calls: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (_cmd: string, args: { query: string }) => {
    calls.push(args.query);
    return answer(args.query);
  },
}));

const { canSearchAhead, filterRepos, forgetSearches, searchSkillRepos, throttledFor } =
  await import("./discover");

const repo = (name: string, over: Partial<{ description: string; topics: string[]; stars: number }> = {}) => ({
  name,
  owner: name.split("/")[0],
  description: "",
  url: `https://github.com/${name}`,
  stars: 10,
  topics: [] as string[],
  ...over,
});

beforeEach(() => {
  calls = [];
  answer = () => ({ repos: [repo("a/b")], remaining: 9 });
  forgetSearches();
});

test("the same words are only searched once", async () => {
  await searchSkillRepos("notion");
  await searchSkillRepos("Notion");
  await searchSkillRepos("  notion  ");
  expect(calls).toEqual(["notion"]);
});

test("two callers typing at once make one request", async () => {
  const both = await Promise.all([searchSkillRepos("pdf"), searchSkillRepos("pdf")]);
  expect(calls).toEqual(["pdf"]);
  expect(both[0].repos).toEqual(both[1].repos);
});

test("being refused reports the wait instead of throwing", async () => {
  answer = () => ({ repos: [], remaining: 0, retryAfter: 42 });
  const found = await searchSkillRepos("docx");
  expect(found.waitSeconds).toBe(42);
  expect(throttledFor()).toBeGreaterThan(40);
});

test("nothing is sent while GitHub is refusing", async () => {
  answer = () => ({ repos: [], remaining: 0, retryAfter: 30 });
  await searchSkillRepos("first");
  calls = [];

  const found = await searchSkillRepos("second");
  expect(calls).toEqual([]);
  expect(found.waitSeconds).toBeGreaterThan(0);
});

test("a refusal is not remembered as the answer", async () => {
  answer = () => ({ repos: [repo("half/result")], remaining: 0, retryAfter: 1 });
  await searchSkillRepos("partial");
  // Once the wait is over the same words are worth asking about again.
  await new Promise((done) => setTimeout(done, 1100));
  answer = () => ({ repos: [repo("full/result")], remaining: 9 });
  const again = await searchSkillRepos("partial");

  expect(calls).toEqual(["partial", "partial"]);
  expect(again.repos).toEqual([repo("full/result")]);
});

test("searching stops short of the limit instead of running into it", async () => {
  answer = () => ({ repos: [], remaining: 9 });
  await searchSkillRepos("plenty");
  expect(canSearchAhead()).toBe(true);

  answer = () => ({ repos: [], remaining: 1 });
  await searchSkillRepos("nearly-out");
  expect(canSearchAhead()).toBe(false);
});

test("filtering what we already have ranks the name first", () => {
  const repos = [
    repo("someone/pdf-helper", { stars: 5 }),
    repo("other/tools", { description: "Work with PDF files", stars: 900 }),
    repo("third/unrelated", { topics: ["cooking"] }),
  ];
  const hits = filterRepos(repos, "pdf");
  expect(hits.map((r) => r.name)).toEqual(["someone/pdf-helper", "other/tools"]);
});

test("filtering needs every word, and matches topics", () => {
  const repos = [repo("a/one", { description: "slides and decks", topics: ["office"] })];
  expect(filterRepos(repos, "slides decks")).toHaveLength(1);
  expect(filterRepos(repos, "office slides")).toHaveLength(1);
  expect(filterRepos(repos, "slides missing")).toHaveLength(0);
});
