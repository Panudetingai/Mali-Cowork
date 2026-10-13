import { expect, test } from "bun:test";
import { FEEDBACK_PROMPT_AFTER_LAUNCHES, FEEDBACK_REPROMPT_DAYS, shouldAskForFeedback } from "./feedback-store";

const day = 24 * 60 * 60 * 1000;
const base = { launches: FEEDBACK_PROMPT_AFTER_LAUNCHES, rated: null, dismissedAt: null, dismissals: 0 };

test("asks once there have been enough launches", () => {
  expect(shouldAskForFeedback({ ...base, launches: FEEDBACK_PROMPT_AFTER_LAUNCHES - 1 })).toBe(false);
  expect(shouldAskForFeedback(base)).toBe(true);
});

test("never asks again after a rating", () => {
  expect(shouldAskForFeedback({ ...base, rated: 5 })).toBe(false);
  expect(shouldAskForFeedback({ ...base, rated: 1, launches: 999 })).toBe(false);
});

test("put off once, it waits; put off twice, it stops", () => {
  const now = Date.now();
  expect(shouldAskForFeedback({ ...base, dismissedAt: now - day, dismissals: 1 }, now)).toBe(false);
  expect(shouldAskForFeedback({ ...base, dismissedAt: now - (FEEDBACK_REPROMPT_DAYS + 1) * day, dismissals: 1 }, now)).toBe(true);
  expect(shouldAskForFeedback({ ...base, dismissedAt: now - 365 * day, dismissals: 2 }, now)).toBe(false);
});
