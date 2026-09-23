import { beforeEach, describe, expect, test } from "bun:test";
import { effortFor, setEffortFor, storedEffortFor } from "./store";

const LEVELS = ["none", "low", "medium", "high", "xhigh"];

describe("the effort a model runs at", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // No storage in this environment; the store falls back to memory.
    }
  });

  test("starts at the model's default and remembers what you pick", () => {
    expect(effortFor("api:openai/gpt-5.2", LEVELS)).toBe("medium");
    setEffortFor("api:openai/gpt-5.2", "high");
    expect(effortFor("api:openai/gpt-5.2", LEVELS)).toBe("high");
  });

  // "High" on a small model and "high" on a large one are different prices,
  // so turning one down must not turn them all down.
  test("is remembered per model, not once for everything", () => {
    setEffortFor("api:openai/gpt-5.2", "xhigh");
    expect(effortFor("api:anthropic/claude-opus-5", LEVELS)).toBe("medium");
  });

  // Providers revise their level sets; a stale choice would be rejected by
  // the backend outright, so it falls back rather than being sent.
  test("a level the model no longer offers is not sent", () => {
    setEffortFor("cli:codex", "xhigh");
    expect(effortFor("cli:codex", ["low", "medium", "high"])).toBe("medium");
  });

  test("a model with no choice to make sends nothing", () => {
    setEffortFor("api:x/y", "high");
    expect(effortFor("api:x/y", undefined)).toBeUndefined();
    expect(effortFor("api:x/y", ["high"])).toBeUndefined();
  });
});

// A retry on a CLI agent only has the model id to go on: its levels live
// with the CLI, not in the shared model metadata.
describe("when the levels are not to hand", () => {
  test("the last choice for that model is still known", () => {
    expect(storedEffortFor("cli:codex/gpt-5.3")).toBeUndefined();
    setEffortFor("cli:codex/gpt-5.3", "high");
    expect(storedEffortFor("cli:codex/gpt-5.3")).toBe("high");
  });
});
