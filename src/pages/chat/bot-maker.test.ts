import { expect, test } from "bun:test";
import { BOT_ANGLES, previewMascots, uniqueName } from "./bot-maker";

test("two options with one name are saved apart", () => {
  expect(uniqueName("Writer", [])).toBe("Writer");
  expect(uniqueName("Writer", ["writer"])).toBe("Writer 2");
  expect(uniqueName("Writer", ["Writer", "Writer 2"])).toBe("Writer 3");
  expect(uniqueName("  ", [])).toBe("My bot");
});

test("each of the three options gets its own face", () => {
  const faces = previewMascots();
  expect(faces).toHaveLength(BOT_ANGLES.length);
  expect(new Set(faces).size).toBe(BOT_ANGLES.length);
});
