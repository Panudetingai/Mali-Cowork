import { describe, expect, test } from "bun:test";
import { voiceDetector } from "./recorder";

/** Feed `ms` of one level, 50 ms at a time, from `start`. */
function feed(vad: ReturnType<typeof voiceDetector>, level: number, start: number, ms: number) {
  let last = { spoke: false, done: false };
  for (let t = start; t < start + ms; t += 50) last = vad(level, t);
  return last;
}

describe("voiceDetector", () => {
  test("ends after speech and a pause", () => {
    const vad = voiceDetector();
    expect(feed(vad, 0.01, 0, 1000)).toEqual({ spoke: false, done: false });
    expect(feed(vad, 0.3, 1000, 1500)).toEqual({ spoke: true, done: false });
    expect(feed(vad, 0.01, 2500, 1000).done).toBe(false);
    expect(feed(vad, 0.01, 3500, 600).done).toBe(true);
  });

  test("a noisy room still ends", () => {
    const vad = voiceDetector();
    // A fan well above a fixed "quiet" line.
    feed(vad, 0.09, 0, 4000);
    expect(feed(vad, 0.5, 4000, 1500).spoke).toBe(true);
    expect(feed(vad, 0.09, 5500, 2000).done).toBe(true);
  });

  test("a click isn't speech", () => {
    const vad = voiceDetector();
    feed(vad, 0.01, 0, 500);
    feed(vad, 0.6, 500, 100);
    expect(feed(vad, 0.01, 600, 3000)).toEqual({ spoke: false, done: false });
  });

  test("a long talk with pauses between words keeps going", () => {
    const vad = voiceDetector();
    feed(vad, 0.01, 0, 500);
    let last = { spoke: false, done: false };
    for (let t = 500; t < 30_500; t += 500) {
      last = feed(vad, 0.25, t, 400);
      expect(last.done).toBe(false);
      last = feed(vad, 0.03, t + 400, 100);
    }
    expect(last).toEqual({ spoke: true, done: false });
  });
});
