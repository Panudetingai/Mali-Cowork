import { expect, test } from "bun:test";
import { extractChatBlocks } from "./parse";

test("a lone image URL becomes an inline image, not a link to copy", () => {
  const out = extractChatBlocks("Here is the screenshot:\n\nhttps://cdn.example.com/shot.png");
  expect(out.text).toContain("![](https://cdn.example.com/shot.png)");
  expect(out.mediaPreviews).toHaveLength(0);
});

test("a lone video URL becomes a preview card", () => {
  const out = extractChatBlocks("[the clip](https://cdn.example.com/demo.mp4)");
  expect(out.mediaPreviews).toEqual([
    { kind: "video", url: "https://cdn.example.com/demo.mp4", title: "the clip" },
  ]);
  expect(out.text).toBe("");
});

test("a sentence that merely mentions a picture keeps its prose", () => {
  const line = "I saved it to https://cdn.example.com/shot.png for you.";
  const out = extractChatBlocks(line);
  expect(out.text).toBe(line);
  expect(out.mediaPreviews).toHaveLength(0);
});

test("markdown images are left where the agent put them", () => {
  const out = extractChatBlocks("before\n![a chart](https://cdn.example.com/chart.png)\nafter");
  expect(out.text).toContain("before");
  expect(out.text).toContain("![a chart](https://cdn.example.com/chart.png)");
  expect(out.text).toContain("after");
});

test("a non-media link is still a link", () => {
  const out = extractChatBlocks("https://example.com/docs/getting-started");
  expect(out.text).toBe("https://example.com/docs/getting-started");
  expect(out.mediaPreviews).toHaveLength(0);
});

test("the same clip linked twice only renders once", () => {
  const out = extractChatBlocks(
    "<https://cdn.example.com/demo.mp4>\n\nhttps://cdn.example.com/demo.mp4",
  );
  expect(out.mediaPreviews).toHaveLength(1);
});

test("explicit preview blocks still win", () => {
  const out = extractChatBlocks(
    '```preview\n{"kind":"image","url":"https://cdn.example.com/a.png","title":"A"}\n```',
  );
  expect(out.mediaPreviews).toEqual([
    { kind: "image", url: "https://cdn.example.com/a.png", title: "A", description: undefined, thumbnail: undefined },
  ]);
});
