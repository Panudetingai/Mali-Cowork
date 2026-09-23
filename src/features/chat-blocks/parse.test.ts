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

test("a generated picture is shown from the file the Media tool saved", () => {
  const out = extractChatBlocks(
    'Here it is!\n\n```media\n{"kind":"image","path":"/Users/me/media/a cat.png","title":"a cat"}\n```',
  );
  expect(out.mediaPreviews).toEqual([
    { kind: "image", url: "/Users/me/media/a cat.png", local: true, title: "a cat", description: undefined },
  ]);
  expect(out.text).toBe("Here it is!");
});

test("a generated clip is recognised by its extension, not by what the block claims", () => {
  const out = extractChatBlocks('```media\n{"kind":"image","path":"/tmp/clip.mp4"}\n```');
  expect(out.mediaPreviews[0]?.kind).toBe("video");
  expect(out.mediaPreviews[0]?.local).toBe(true);
});

test("windows paths are files too", () => {
  const out = extractChatBlocks('```media\n{"path":"C:\\\\Users\\\\me\\\\a.png"}\n```');
  expect(out.mediaPreviews[0]?.url).toBe("C:\\Users\\me\\a.png");
});

// The block comes back through the model, so a prompt could talk it into
// naming any file. Only a picture or a clip is ever read.
test("a media block naming something that isn't media is dropped", () => {
  for (const path of ["/Users/me/.ssh/id_rsa", "/etc/passwd", "~/notes.txt", "relative/a.png"]) {
    const out = extractChatBlocks(`\`\`\`media\n{"path":"${path}"}\n\`\`\``);
    expect(out.mediaPreviews).toHaveLength(0);
  }
});

test("a media block holding a web address is treated as a preview", () => {
  const out = extractChatBlocks('```media\n{"kind":"image","url":"https://cdn.example.com/a.png"}\n```');
  expect(out.mediaPreviews[0]).toMatchObject({ kind: "image", url: "https://cdn.example.com/a.png" });
  expect(out.mediaPreviews[0]?.local).toBeUndefined();
});

test("a media block still streaming in doesn't show as raw JSON", () => {
  const out = extractChatBlocks('Making it now…\n\n```media\n{"kind":"image","pa');
  expect(out.text).toBe("Making it now…");
  expect(out.mediaPreviews).toHaveLength(0);
});
