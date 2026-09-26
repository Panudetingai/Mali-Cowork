import { describe, expect, test } from "bun:test";
import { formatChatError } from "./turn";

describe("formatChatError", () => {
  test("explains opaque reqwest decode errors", () => {
    const text = formatChatError(new Error("error decoding response body"));
    expect(text).toContain("error decoding response body");
    expect(text).toContain("Settings → Models");
    expect(text).toContain("connector");
  });
});
