import { describe, expect, test } from "vitest";
import { connectorLiveConnected } from "./sync";

describe("connectorLiveConnected", () => {
  test("requires hub status connected, not just the saved switch", () => {
    expect(connectorLiveConnected(true, { id: "notion", status: "connected" })).toBe(true);
    expect(connectorLiveConnected(true, { id: "notion", status: "disabled" })).toBe(false);
    expect(connectorLiveConnected(true, { id: "notion", status: "failed", error: "x" })).toBe(false);
    expect(connectorLiveConnected(true, undefined)).toBe(false);
    expect(connectorLiveConnected(false, { id: "notion", status: "connected" })).toBe(false);
  });
});
