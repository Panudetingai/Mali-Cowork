import { describe, expect, test } from "bun:test";
import { loadingGroupKeysFor } from "./use-model-catalog";

describe("loadingGroupKeysFor", () => {
  test("flags OpenCode while its list is loading", () => {
    const keys = loadingGroupKeysFor({
      opencode: { loading: true },
      cursor: { loading: false, loggedIn: true },
      antigravity: { loading: false, loggedIn: true },
      cliFilter: {},
    });
    expect(keys.has("opencode:OpenCode")).toBe(true);
  });

  test("flags Cursor only when signed in and fetching", () => {
    expect(
      loadingGroupKeysFor({
        opencode: { loading: false },
        cursor: { loading: true, loggedIn: false },
        antigravity: { loading: false, loggedIn: false },
        cliFilter: {},
      }).has("cli:Cursor CLI"),
    ).toBe(false);
    expect(
      loadingGroupKeysFor({
        opencode: { loading: false },
        cursor: { loading: true, loggedIn: true },
        antigravity: { loading: false, loggedIn: false },
        cliFilter: {},
      }).has("cli:Cursor CLI"),
    ).toBe(true);
  });
});
