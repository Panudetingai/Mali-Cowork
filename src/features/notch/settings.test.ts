import { describe, expect, test } from "bun:test";
import { glassBlurVisuals } from "./settings";

describe("glassBlurVisuals", () => {
  test("blur and tint scale with the slider", () => {
    const low = glassBlurVisuals(0);
    const high = glassBlurVisuals(100);
    expect(high.blurPx).toBeGreaterThan(low.blurPx);
    expect(high.tintAlpha).toBeLessThan(low.tintAlpha);
  });
});
