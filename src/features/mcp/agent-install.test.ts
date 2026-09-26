import { describe, expect, test } from "bun:test";
import { connectorInstructionsFor, extractConnectorBlocks } from "./agent-install";

describe("connectorInstructionsFor", () => {
  test("is always included so the model can suggest MCP when stuck", () => {
    const text = connectorInstructionsFor();
    expect(text).toContain("Connectors (MCP)");
    expect(text).toContain("```connector");
    expect(text).toContain("registry.modelcontextprotocol.io");
    expect(text).toContain("never ask the user to paste");
  });
});

describe("extractConnectorBlocks", () => {
  test("parses a suggestion block", () => {
    const reply = 'Try this.\n\n```connector\n{"query": "notion"}\n```';
    const { text, suggestions } = extractConnectorBlocks(reply);
    expect(text.trim()).toBe("Try this.");
    expect(suggestions).toEqual([{ query: "notion" }]);
  });
});
