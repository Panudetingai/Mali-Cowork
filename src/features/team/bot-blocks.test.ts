import { expect, test } from "bun:test";
import { botBlockInstructions, extractBotBlocks } from "./bot-blocks";

const reply = `อ่านหน้า Notion แล้ว ได้บอทนี้ครับ

\`\`\`bot
{"name": "นักออกแบบโพสต์", "role": "ออกแบบโพสต์ขายของตามแบรนด์", "instructions": ["อ่านบรีฟ", "ออกแบบใน Canva"], "tools": "none", "connectors": ["custom-canva", {"id": "custom-notion"}], "skills": "brand-guidelines"}
\`\`\``;

test("a reply's bot comes out of it, read kindly", () => {
  const { text, bots } = extractBotBlocks(reply);
  expect(text.trim()).toBe("อ่านหน้า Notion แล้ว ได้บอทนี้ครับ");
  expect(bots).toHaveLength(1);
  expect(bots[0].instructions).toBe("อ่านบรีฟ\nออกแบบใน Canva");
  expect(bots[0].connectors).toEqual(["custom-canva", "custom-notion"]);
  expect(bots[0].skills).toEqual(["brand-guidelines"]);
  expect(bots[0].tools).toBe("none");
});

test("a block still streaming is hidden, and a broken one is dropped", () => {
  expect(extractBotBlocks('Working…\n```bot\n{"name": "Ha').text).toBe("Working…\n");
  expect(extractBotBlocks("```bot\n{not json}\n```").bots).toEqual([]);
  expect(extractBotBlocks('```bot\n{"name": "x"}\n```').bots).toEqual([]);
  expect(extractBotBlocks("```botany\nnot a bot\n```").text).toContain("botany");
});

test("an unknown file access falls back to reading", () => {
  expect(extractBotBlocks('```bot\n{"name": "a", "role": "b", "tools": "root"}\n```').bots[0].tools).toBe("read");
});

test("the AI is told it can't make a bot any other way", () => {
  expect(botBlockInstructions()).toContain("```bot");
  expect(botBlockInstructions()).toContain("never claim it's created");
});
