import { expect, test } from "bun:test";
import { asRegistryServer, smitheryRegistryName, type SmitheryServerDetail } from "./api";
import { checkInstall, installOptions } from "@/features/mcp";

const detail = (over: Partial<SmitheryServerDetail> = {}): SmitheryServerDetail => ({
  qualifiedName: "node2flow/notion",
  name: "Notion",
  description: "Manage Notion pages",
  url: "https://notion--node2flow.run.tools",
  config: [],
  tools: ["notion-search"],
  ...over,
});

const KEY_FIELD = {
  name: "NOTION_API_KEY",
  description: "Integration token",
  required: true,
  secret: true,
};

test("a server with no settings installs at its own address", () => {
  const server = asRegistryServer(detail());
  expect(server.remotes[0].url).toBe("https://notion--node2flow.run.tools");
  expect(server.name).toBe("smithery:node2flow/notion");
  expect(server.packages).toEqual([]);
});

test("settings become query parameters the install dialog fills in", () => {
  const server = asRegistryServer(
    detail({ config: [KEY_FIELD, { name: "TIMEOUT", description: "", required: false, secret: false, default: "30000" }] }),
  );
  expect(server.remotes[0].url).toBe(
    "https://notion--node2flow.run.tools?NOTION_API_KEY={NOTION_API_KEY}&TIMEOUT={TIMEOUT}",
  );

  const [option] = installOptions(server);
  const key = option.fields.find((f) => f.label === "NOTION_API_KEY");
  expect(key?.required).toBe(true);
  expect(key?.secret).toBe(true);
  expect(option.fields.find((f) => f.label === "TIMEOUT")?.defaultValue).toBe("30000");
});

test("the filled-in URL is what actually gets connected to", () => {
  const server = asRegistryServer(detail({ config: [KEY_FIELD] }));
  const [option] = installOptions(server);
  const built = option.build({ "url:NOTION_API_KEY": "secret-123" });
  expect(built.url).toBe("https://notion--node2flow.run.tools?NOTION_API_KEY=secret-123");
});

test("a server whose address already has a query keeps it", () => {
  const server = asRegistryServer(
    detail({ url: "https://host.example/mcp?profile=abc", config: [KEY_FIELD] }),
  );
  expect(server.remotes[0].url).toBe("https://host.example/mcp?profile=abc&NOTION_API_KEY={NOTION_API_KEY}");
});

test("a missing required setting is caught before anything is saved", () => {
  const server = asRegistryServer(detail({ config: [KEY_FIELD] }));
  const [option] = installOptions(server);
  expect(checkInstall(option, {})).toContain("NOTION_API_KEY is required");
  expect(checkInstall(option, { "url:NOTION_API_KEY": "secret-123" })).toEqual([]);
});

/** Smithery is someone else's catalogue; its URLs get the same scrutiny. */
test("a non-https address is refused the same as anywhere else", () => {
  const server = asRegistryServer(detail({ url: "http://insecure.example" }));
  const [option] = installOptions(server);
  expect(checkInstall(option, {})).toContain("The server URL must use https://");
});

test("an install is remembered under a name that can't collide", () => {
  expect(smitheryRegistryName("node2flow/notion")).toBe("smithery:node2flow/notion");
  expect(asRegistryServer(detail()).name).toBe(smitheryRegistryName("node2flow/notion"));
});
