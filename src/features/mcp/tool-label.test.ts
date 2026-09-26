import { describe, expect, test } from "bun:test";
import { mcpToolOf } from "./tool-label";

// CLI agents reach connectors through Mali's `mali` gateway and prefix the
// tool names with it; the step list still shows the connector itself.
describe("mcpToolOf", () => {
  test("reads a connector call made through the gateway", () => {
    const direct = mcpToolOf("fetch_fetch");
    const viaGateway = mcpToolOf("mali_fetch_fetch");
    expect(direct?.serverId).toBe("fetch");
    expect(viaGateway?.serverId).toBe("fetch");
    expect(viaGateway?.tool).toBe(direct?.tool);
  });

  test("leaves the agent's own tools alone", () => {
    expect(mcpToolOf("read_file")).toBeUndefined();
    expect(mcpToolOf("mali_unknown_tool")).toBeUndefined();
  });
});
