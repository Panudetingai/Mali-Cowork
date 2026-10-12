import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeOptions, configProblem, DEFAULT_ANTHROPIC_MODEL, generateBot, generatorConfig, listModels, parseDraft, type Draft } from "../src/generate";

const draft: Draft = {
  name: "PR Reviewer",
  slug: "pr-reviewer",
  duty: "Reviews pull requests.",
  instructions: "You review pull requests.",
  tools: "read",
  capabilities: ["Reads diffs"],
  examples: ["Review PR #4"],
  connectors: ["github", "gmail"],
  skills: [{ name: "Review Checklist", description: "Checklist", body: "- Tests?" }],
  notes: "Add a Gmail MCP server for mail.",
};

/** A stand-in for the SDK client: records the request, answers with `reply`. */
function fakeClaude(reply: { stop_reason: string; text: string }) {
  const calls: unknown[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return { stop_reason: reply.stop_reason, content: [{ type: "text", text: reply.text }] };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("generating a bot", () => {
  test("defaults to Claude", () => {
    expect(generatorConfig({}, {})).toMatchObject({ provider: "anthropic", kind: "anthropic", model: DEFAULT_ANTHROPIC_MODEL });
    expect(generatorConfig({}, { BOT_FORGE_MODEL: "claude-sonnet-5-5" }).model).toBe("claude-sonnet-5-5");
  });

  test("asks Claude for structured output and builds the bot from the catalog", async () => {
    const { client, calls } = fakeClaude({ stop_reason: "end_turn", text: JSON.stringify(draft) });
    const out = await generateBot("a bot that reviews PRs", generatorConfig({}, {}), { anthropic: client });
    const params = calls[0] as Record<string, any>;
    expect(params.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(out.spec.connectors.map((c) => c.name)).toEqual(["github"]);
    expect(out.spec.connectors[0].kind === "local" && out.spec.connectors[0].command).toBe("npx");
    expect(out.unknownConnectors).toEqual(["gmail"]);
    expect(out.spec.skills[0].name).toBe("review-checklist");
    expect(out.spec.origin).toMatchObject({ prompt: "a bot that reviews PRs", provider: "anthropic" });
    expect(out.notes).toContain("Gmail");
  });

  test("a refusal or a cut-off answer is said plainly", async () => {
    const refused = fakeClaude({ stop_reason: "refusal", text: "" });
    await expect(generateBot("x", generatorConfig({}, {}), { anthropic: refused.client })).rejects.toThrow("declined");
    const cut = fakeClaude({ stop_reason: "max_tokens", text: "{" });
    await expect(generateBot("x", generatorConfig({}, {}), { anthropic: cut.client })).rejects.toThrow("cut off");
  });

  test("works with an OpenAI-compatible endpoint", async () => {
    let seen: { url: string; body: any } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(draft) + "\n```" } }] }));
    }) as unknown as typeof fetch;
    const config = generatorConfig({}, { BOT_FORGE_PROVIDER: "openai", BOT_FORGE_MODEL: "local-model", OPENAI_BASE_URL: "http://localhost:11434/v1/", OPENAI_API_KEY: "k" });
    const out = await generateBot("x", config, { fetch: fakeFetch });
    expect(seen!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(seen!.body.model).toBe("local-model");
    expect(out.spec.name).toBe("PR Reviewer");
  });

  test("an incomplete design is refused", () => {
    expect(() => parseDraft('{"name":"x"}')).toThrow("incomplete");
    expect(() => parseDraft("not json")).toThrow("not JSON");
  });
});

/** A fake OpenAI-compatible server: answers each chat request with the next reply. */
function fakeServer(replies: (string | { status: number; body: string })[]) {
  const requests: any[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }, { id: "llama3.2" }] }));
    requests.push(JSON.parse(init!.body as string));
    const next = replies.shift()!;
    if (typeof next !== "string") return new Response(next.body, { status: next.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: next }, finish_reason: "stop" }] }));
  }) as unknown as typeof fetch;
  return { fetcher, requests };
}

describe("any provider", () => {
  const ollama = generatorConfig({ provider: "ollama", model: "qwen3:8b" }, {});

  test("presets fill in the address and the key's variable", () => {
    expect(ollama).toMatchObject({ kind: "openai", baseUrl: "http://localhost:11434/v1", model: "qwen3:8b" });
    expect(configProblem(ollama)).toBeNull();
    const groq = generatorConfig({ provider: "groq", model: "m" }, { GROQ_API_KEY: "g" });
    expect(groq).toMatchObject({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "g" });
    expect(configProblem(generatorConfig({ provider: "groq", model: "m" }, {}))).toContain("GROQ_API_KEY");
    expect(configProblem(generatorConfig({ provider: "groq" }, { GROQ_API_KEY: "g" }))).toContain("Pick a model");
    expect(configProblem(generatorConfig({ provider: "custom", model: "m" }, {}))).toContain("address");
    expect(() => generatorConfig({ provider: "nope" }, {})).toThrow("Unknown provider");
  });

  test("flags beat what was saved, which beats the environment", () => {
    const saved = { provider: "ollama", model: "llama3.2" };
    expect(generatorConfig({}, { BOT_FORGE_PROVIDER: "groq" }, saved)).toMatchObject({ provider: "ollama", model: "llama3.2" });
    expect(generatorConfig({ model: "qwen3:8b" }, {}, saved).model).toBe("qwen3:8b");
    // A model saved for one provider isn't carried to another.
    expect(generatorConfig({ provider: "lmstudio" }, {}, saved).model).toBe("");
  });

  test("a local model's thinking, prose and missing fields are forgiven", async () => {
    const reply = `<think>Let me plan the bot…</think>Sure! Here it is:\n{"name":"Mail Sorter","instructions":"You sort mail.","tools":"everything","connectors":[{"id":"github"}],"capabilities":"Sorts mail"}`;
    const { fetcher } = fakeServer([reply]);
    const out = await generateBot("sort my mail", ollama, { fetch: fetcher });
    expect(out.spec).toMatchObject({ name: "Mail Sorter", slug: "mail-sorter", tools: "read", duty: "Sorts mail", capabilities: ["Sorts mail"] });
    expect(out.spec.connectors.map((c) => c.name)).toEqual(["github"]);
  });

  test("a server without JSON mode is asked again without it", async () => {
    const { fetcher, requests } = fakeServer([{ status: 400, body: '{"error":"response_format is not supported"}' }, JSON.stringify(draft)]);
    const out = await generateBot("x", ollama, { fetch: fetcher });
    expect(requests[0].response_format).toEqual({ type: "json_object" });
    expect(requests[1].response_format).toBeUndefined();
    expect(out.spec.name).toBe("PR Reviewer");
  });

  test("an answer that isn't a design gets one chance to be fixed", async () => {
    const { fetcher, requests } = fakeServer(["I can't do JSON, but the bot is called Reviewer.", JSON.stringify(draft)]);
    const out = await generateBot("x", ollama, { fetch: fetcher });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toContain("only the JSON object");
    expect(out.spec.name).toBe("PR Reviewer");
    const { fetcher: twice } = fakeServer(["nope", "still nope"]);
    await expect(generateBot("x", ollama, { fetch: twice })).rejects.toThrow("not JSON");
  });

  test("errors say what to do", async () => {
    const { fetcher } = fakeServer([{ status: 404, body: "model not found" }]);
    await expect(generateBot("x", ollama, { fetch: fetcher })).rejects.toThrow('doesn\'t know the model "qwen3:8b"');
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(generateBot("x", ollama, { fetch: down })).rejects.toThrow("Is Ollama running?");
  });

  test("lists a server's models", async () => {
    expect(await listModels(ollama, { fetch: fakeServer([]).fetcher })).toEqual(["llama3.2", "qwen3:8b"]);
  });

  test("Claude models get only the options they take", () => {
    expect(claudeOptions("claude-opus-5-5")).toMatchObject({ fallbacks: "default", output_config: { effort: "medium" } });
    const haiku = claudeOptions("claude-haiku-5-5");
    expect("fallbacks" in haiku).toBe(false);
    expect(haiku.output_config).toMatchObject({ effort: "medium" });
    const older = claudeOptions("claude-haiku-4-5");
    expect("fallbacks" in older).toBe(false);
    expect("effort" in older.output_config).toBe(false);
    expect(older.output_config.format.type).toBe("json_schema");
  });
});
