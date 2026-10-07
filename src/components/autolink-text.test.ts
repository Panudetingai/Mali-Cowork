import { describe, expect, test } from "bun:test";
import { splitTextByUrls } from "./autolink-text";

describe("splitTextByUrls", () => {
  test("splits a single URL", () => {
    expect(splitTextByUrls("see https://canva.com/d/abc")).toEqual([
      { kind: "text", value: "see " },
      { kind: "url", value: "https://canva.com/d/abc", href: "https://canva.com/d/abc" },
    ]);
  });

  test("leaves trailing punctuation as plain text", () => {
    expect(splitTextByUrls("https://example.com.")).toEqual([
      { kind: "url", value: "https://example.com", href: "https://example.com" },
      { kind: "text", value: "." },
    ]);
  });
});
