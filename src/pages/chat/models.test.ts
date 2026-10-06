import { describe, expect, test } from "bun:test";
import type { OpencodeModel, OpencodeModelsResult } from "@/features/opencode";
import {
  apiModelId,
  buildMediaCatalog,
  buildModelCatalog,
  chatIssueOf,
  customCliOf,
  findModel,
  mediaKindForId,
  mediaKindOf,
  OPENCODE_PREFIX,
} from "./models";
import type { ProviderDef } from "@/features/providers";

function model(overrides: Partial<OpencodeModel> & Pick<OpencodeModel, "id">): OpencodeModel {
  const [providerId, name] = overrides.id.split("/");
  return {
    name,
    providerId,
    providerName: providerId,
    free: false,
    connected: true,
    contextLimit: 200_000,
    toolCall: true,
    output: ["text"],
    ...overrides,
  };
}

function provider(id: string, name: string): ProviderDef {
  return {
    id,
    name,
    description: "",
    logo: id,
    group: "cloud",
    defaultBaseUrl: "",
    defaultModels: "",
    keyRequired: true,
  };
}

const ZEN_FREE = "opencode/grok-code";
const ZEN_PAID = "opencode/claude-sonnet-5";
const GROQ_FREE = "groq/openai-gpt-oss-120b";

function catalogFor(mode: "chat" | "cowork", models: OpencodeModel[], defaultModel?: string) {
  const opencode: OpencodeModelsResult = { models, defaultModel, providers: [] };
  return buildModelCatalog(opencode, [], mode);
}

const ids = (catalog: ReturnType<typeof buildModelCatalog>) => catalog.map((m) => m.id);

describe("chatIssueOf", () => {
  test("holds back Zen's free tier, which Chat's tool-less requests are refused for", () => {
    expect(chatIssueOf({ provider: "opencode", source: "opencode", free: true })).toBeTruthy();
  });

  test("leaves paid Zen models and every other provider alone", () => {
    expect(chatIssueOf({ provider: "opencode", source: "opencode", free: false })).toBeUndefined();
    // Free elsewhere is just free: only Zen gates on the shape of the request.
    expect(chatIssueOf({ provider: "groq", source: "opencode", free: true })).toBeUndefined();
    expect(chatIssueOf({ provider: "openai", source: "api", free: false })).toBeUndefined();
  });
});

describe("buildModelCatalog", () => {
  const models = [
    model({ id: ZEN_FREE, free: true }),
    model({ id: ZEN_PAID }),
    model({ id: GROQ_FREE, free: true }),
  ];

  test("marks Zen's free models as not for Chat and leaves the rest pickable", () => {
    const catalog = catalogFor("chat", models);
    const issueOf = (id: string) => catalog.find((m) => m.id === `${OPENCODE_PREFIX}${id}`)?.issue;
    expect(issueOf(ZEN_FREE)).toBeTruthy();
    expect(issueOf(ZEN_PAID)).toBeUndefined();
    expect(issueOf(GROQ_FREE)).toBeUndefined();
  });

  test("offers the same free Zen model in Cowork, where the tools it wants are there", () => {
    const catalog = catalogFor("cowork", models);
    expect(catalog.find((m) => m.id === `${OPENCODE_PREFIX}${ZEN_FREE}`)?.issue).toBeUndefined();
  });

  test("Cowork still drops models that can't call tools or can't hold a task", () => {
    const catalog = catalogFor("cowork", [
      model({ id: "x/no-tools", toolCall: false }),
      model({ id: "x/tiny", contextLimit: 8_000 }),
      model({ id: "x/fine" }),
    ]);
    const issueOf = (id: string) => catalog.find((m) => m.id === `${OPENCODE_PREFIX}x/${id}`)?.issue;
    expect(issueOf("no-tools")).toBeTruthy();
    expect(issueOf("tiny")).toBeTruthy();
    expect(issueOf("fine")).toBeUndefined();
  });

  test("Auto is only as usable as the model OpenCode would pick", () => {
    const onFree = catalogFor("chat", models, ZEN_FREE);
    expect(onFree.find((m) => m.id === `${OPENCODE_PREFIX}default`)?.issue).toBeTruthy();
    const onPaid = catalogFor("chat", models, ZEN_PAID);
    expect(onPaid.find((m) => m.id === `${OPENCODE_PREFIX}default`)?.issue).toBeUndefined();
  });
});

describe("findModel", () => {
  test("swaps a model that can't work here for one from the same provider", () => {
    const catalog = catalogFor("chat", [
      model({ id: ZEN_FREE, free: true }),
      model({ id: ZEN_PAID }),
    ]);
    const picked = findModel(catalog, `${OPENCODE_PREFIX}${ZEN_FREE}`);
    expect(picked.issue).toBeUndefined();
    expect(picked.provider).toBe("opencode");
    expect(ids(catalog)).toContain(picked.id);
  });

  test("keeps a model the catalog hasn't loaded yet rather than moving the chat", () => {
    const picked = findModel(catalogFor("chat", []), `${OPENCODE_PREFIX}anthropic/claude-opus-5`);
    expect(picked.id).toBe(`${OPENCODE_PREFIX}anthropic/claude-opus-5`);
  });
});


describe("models that draw", () => {
  const GEMINI_IMAGE = "google/gemini-3-pro-image-preview";
  const VEO = "google/veo-3.1-generate-preview";
  const GEMINI = "google/gemini-3-pro";

  const catalogue = {
    models: [
      model({ id: GEMINI_IMAGE, output: ["text", "image"], toolCall: false }),
      model({ id: VEO, output: ["video"], toolCall: false, contextLimit: 480 }),
      model({ id: GEMINI }),
    ],
    defaultModel: undefined,
    providers: [],
  };
  const gemini = [{ provider: provider("google", "Gemini"), models: ["gemini-3-pro"] }];
  const ids = (list: ReturnType<typeof buildMediaCatalog>) => list.map((m) => m.id);

  test("reads what a model produces from its metadata", () => {
    expect(mediaKindOf(catalogue.models[0])).toBe("image");
    expect(mediaKindOf(catalogue.models[1])).toBe("video");
    expect(mediaKindOf(catalogue.models[2])).toBeUndefined();
    expect(mediaKindOf(undefined)).toBeUndefined();
  });

  // Setting a key once is the whole setup: the provider's picture models show
  // up on their own, so nobody has to know the model ids.
  test("come with the provider's key, without being typed in", () => {
    expect(ids(buildMediaCatalog(catalogue, gemini, "image"))).toEqual([
      apiModelId("google", "gemini-3-pro-image-preview"),
    ]);
    expect(ids(buildMediaCatalog(catalogue, gemini, "video"))).toEqual([
      apiModelId("google", "veo-3.1-generate-preview"),
    ]);
  });

  test("only from providers that are set up", () => {
    expect(buildMediaCatalog(catalogue, [], "image")).toEqual([]);
  });

  // Puter's models are Puter's current list, shown once Puter has a token.
  test("Puter's come from its own list, once it's set up", () => {
    const list = [{ id: "gpt-image-2", name: "GPT Image 2" }];
    expect(buildMediaCatalog(catalogue, [], "image", list)).toEqual([]);
    const puter = [{ provider: provider("puter", "Puter"), models: ["gpt-5.4-nano"] }];
    const made = buildMediaCatalog(catalogue, puter, "image", list);
    expect(ids(made)).toEqual([apiModelId("puter", "gpt-image-2")]);
    expect(made[0]?.group).toBe("Puter");
  });

  test("a chat model is never one of them", () => {
    const listed = ids(buildMediaCatalog(catalogue, gemini, "image"));
    expect(listed).not.toContain(apiModelId("google", "gemini-3-pro"));
  });

  // They would answer nothing at all in a conversation, so the chat picker
  // does not offer them — that is what the Visual page is for.
  test("are kept out of the chat picker, whichever way they got there", () => {
    const chat = buildModelCatalog(
      catalogue,
      [{ provider: provider("google", "Gemini"), models: ["gemini-3-pro-image-preview"] }],
      "chat",
    );
    const typed = chat.find((m) => m.id === apiModelId("google", "gemini-3-pro-image-preview"));
    expect(typed?.issue).toContain("Visual");
    expect(chat.find((m) => m.id === `${OPENCODE_PREFIX}${VEO}`)?.issue).toContain("Visual");
    expect(chat.find((m) => m.id === `${OPENCODE_PREFIX}${GEMINI}`)?.issue).toBeUndefined();
  });
});

// A model typed into Settings → Models by hand is not in models.dev, so it
// arrives with no modalities. `qwen-image-3.0` went down the chat path and
// came back as "Input should be 'user': input.messages.0.role".
describe("models the metadata has never heard of", () => {
  const typedIn = {
    models: [model({ id: "alibaba/qwen-image-3.0", output: [], contextLimit: undefined })],
    defaultModel: undefined,
    providers: [],
  };
  const qwen = [{ provider: provider("alibaba", "Qwen"), models: ["qwen-image-3.0"] }];

  test("a picture model is recognised from its name", () => {
    expect(mediaKindForId(apiModelId("alibaba", "qwen-image-3.0"), typedIn)).toBe("image");
    expect(buildMediaCatalog(typedIn, qwen, "image").map((m) => m.id)).toEqual([
      apiModelId("alibaba", "qwen-image-3.0"),
    ]);
  });

  test("the obvious names are covered, whoever sells them", () => {
    const empty = { models: [], defaultModel: undefined, providers: [] };
    const kind = (p: string, id: string) => mediaKindForId(apiModelId(p, id), empty);
    for (const id of ["qwen-image-3.0", "gpt-image-1", "imagen-4.0-generate-001", "flux-pro", "dall-e-3"]) {
      expect(kind("openai", id)).toBe("image");
    }
    for (const id of ["veo-3.1-generate-preview", "wan2.2-t2v-plus", "sora-2", "grok-imagine-video"]) {
      expect(kind("google", id)).toBe("video");
    }
  });

  // A name is only consulted when the metadata is silent, so a model that
  // merely *reads* pictures is never mistaken for one that draws them.
  test("chat models are not dragged in by a name that mentions pictures", () => {
    const empty = { models: [], defaultModel: undefined, providers: [] };
    for (const id of ["qwen-vl-max", "qwen-vl-ocr", "qwen3-omni-flash", "qwen-plus", "gpt-5.2"]) {
      expect(mediaKindForId(apiModelId("alibaba", id), empty)).toBeUndefined();
    }
  });

  test("metadata still wins over the name", () => {
    const listed = {
      models: [model({ id: "openai/gpt-image-router", output: ["text"] })],
      defaultModel: undefined,
      providers: [],
    };
    expect(mediaKindForId(apiModelId("openai", "gpt-image-router"), listed)).toBeUndefined();
  });
});

// "Alibaba (Qwen) cannot make a video here" was wrong twice over: Qwen makes
// video, and the question is per model, not per provider.
describe("video models", () => {
  test("a Qwen video model is offered for video", () => {
    const wan = {
      models: [model({ id: "alibaba/wan2.2-t2v-plus", output: [] })],
      defaultModel: undefined,
      providers: [],
    };
    const qwen = [{ provider: provider("alibaba", "Qwen"), models: ["wan2.2-t2v-plus"] }];
    expect(mediaKindForId(apiModelId("alibaba", "wan2.2-t2v-plus"), wan)).toBe("video");
    expect(buildMediaCatalog(wan, qwen, "video").map((m) => m.id)).toEqual([
      apiModelId("alibaba", "wan2.2-t2v-plus"),
    ]);
  });

  // Grok Imagine makes video; Mali has no call for it, so it is left out
  // rather than offered and then refused.
  test("a video model from a provider with no video call is left out", () => {
    const grok = { models: [], defaultModel: undefined, providers: [] };
    const xai = [
      { provider: provider("xai", "Grok"), models: ["grok-imagine-video", "grok-imagine-image"] },
    ];
    expect(buildMediaCatalog(grok, xai, "video")).toEqual([]);
    expect(buildMediaCatalog(grok, xai, "image").map((m) => m.id)).toEqual([
      apiModelId("xai", "grok-imagine-image"),
    ]);
  });
});

// A key the user entered belongs to Mali: the model runs on it directly — in
// Chat over the API, in Cowork on Mali's own agent — never "via OpenCode".
describe("models on the user's own key", () => {
  const catalogue = {
    models: [
      model({ id: "openai/gpt-5" }),
      model({ id: "openai/gpt-tiny", toolCall: false }),
      model({ id: "anthropic/claude-sonnet-5" }),
    ],
    defaultModel: undefined,
    providers: [],
  };
  const openai = [{ provider: provider("openai", "OpenAI"), models: ["gpt-5", "gpt-tiny"] }];

  for (const mode of ["chat", "cowork"] as const) {
    test(`are listed once, under the key, in ${mode}`, () => {
      const list = buildModelCatalog(catalogue, openai, mode);
      expect(list.find((m) => m.id === apiModelId("openai", "gpt-5"))?.source).toBe("api");
      expect(list.find((m) => m.id === `${OPENCODE_PREFIX}openai/gpt-5`)).toBeUndefined();
      // Providers without a key in Mali stay on OpenCode.
      expect(list.find((m) => m.id === `${OPENCODE_PREFIX}anthropic/claude-sonnet-5`)).toBeDefined();
    });
  }

  test("that can't call tools are kept out of Cowork, not Chat", () => {
    const tiny = apiModelId("openai", "gpt-tiny");
    expect(buildModelCatalog(catalogue, openai, "cowork").find((m) => m.id === tiny)?.issue).toContain("tools");
    expect(buildModelCatalog(catalogue, openai, "chat").find((m) => m.id === tiny)?.issue).toBeUndefined();
  });
});

describe("custom CLI models", () => {
  const cli = { id: "custom-claude-code", name: "Claude Code", command: "claude", args: "-p {prompt}", models: "" };

  test("one entry for the CLI's default, then one per model listed", () => {
    const plain = buildModelCatalog(null, [], "chat", undefined, undefined, undefined, [cli]).filter((m) => m.group === "Claude Code");
    expect(plain.map((m) => m.id)).toEqual(["cli:custom-claude-code"]);
    const withModels = buildModelCatalog(null, [], "chat", undefined, undefined, undefined, [{ ...cli, models: "sonnet, opus" }]);
    expect(withModels.filter((m) => m.source === "cli" && m.provider === "terminal").map((m) => m.id)).toEqual([
      "cli:custom-claude-code",
      "cli:custom-claude-code/sonnet",
      "cli:custom-claude-code/opus",
    ]);
  });

  test("ids come apart into the CLI and its model", () => {
    expect(customCliOf("cli:custom-x/openai/gpt-5")).toEqual({ id: "custom-x", model: "openai/gpt-5" });
    expect(customCliOf("cli:custom-x")).toEqual({ id: "custom-x", model: undefined });
    expect(customCliOf("api:openai/gpt-5")).toBeUndefined();
  });
});
