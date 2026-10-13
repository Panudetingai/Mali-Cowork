import { expect, test } from "bun:test";
import { slashItems } from "@/pages/chat/components/mention/skill-popup";
import { botWordsIn } from "./write";

test("/bot and its words, in English or Thai", () => {
  expect(botWordsIn("/bot บอทสรุปข่าวเป็นภาษาไทย")).toBe("บอทสรุปข่าวเป็นภาษาไทย");
  expect(botWordsIn("  /newbot a PR reviewer\nwith a checklist")).toBe("a PR reviewer\nwith a checklist");
  expect(botWordsIn("/สร้างบอท ช่วยตอบอีเมล")).toBe("ช่วยตอบอีเมล");
  expect(botWordsIn("/bot")).toBe("");
  expect(botWordsIn("/botany is a science")).toBeUndefined();
  expect(botWordsIn("make a /bot please")).toBeUndefined();
});

test("the / menu offers Make a bot while the query could mean it", () => {
  expect(slashItems([], "").map((i) => i.kind)).toEqual(["files", "bot"]);
  expect(slashItems([], "bo").map((i) => i.kind)).toEqual(["bot"]);
  expect(slashItems([], "fi").map((i) => i.kind)).toEqual(["files"]);
  expect(slashItems([], "xyz")).toEqual([]);
});
