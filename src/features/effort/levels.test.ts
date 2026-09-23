import { describe, expect, test } from "bun:test";
import { defaultEffort, describeEffort, effortLevels } from "./levels";

describe("effort levels", () => {
  test("a model with no choice to make gets no control", () => {
    expect(effortLevels(undefined)).toEqual([]);
    expect(defaultEffort(undefined)).toBeUndefined();
    expect(defaultEffort([])).toBeUndefined();
    // One level is not a choice: there is nothing to move the slider to.
    expect(defaultEffort(["high"])).toBeUndefined();
  });

  test("starts in the middle, not at the most expensive end", () => {
    expect(defaultEffort(["none", "low", "medium", "high", "xhigh"])).toBe("medium");
    expect(defaultEffort(["low", "high"])).toBe("low");
    expect(defaultEffort(["low", "high", "max"])).toBe("high");
  });

  // Providers keep adding levels; an unknown one is still offered, just
  // without a description, rather than dropped or renamed.
  test("a level we have never seen is still usable", () => {
    expect(describeEffort("ludicrous")).toEqual({ id: "ludicrous", label: "Ludicrous" });
    expect(describeEffort("extra_hard").label).toBe("Extra hard");
    expect(effortLevels(["low", "ludicrous"]).map((l) => l.id)).toEqual(["low", "ludicrous"]);
    expect(defaultEffort(["low", "ludicrous"])).toBe("low");
  });

  test("known levels keep the order the model gave them", () => {
    const levels = effortLevels(["none", "low", "medium", "high"]);
    expect(levels.map((l) => l.label)).toEqual(["None", "Low", "Medium", "High"]);
    expect(levels.every((l) => l.hint)).toBe(true);
  });
});
