import { describe, expect, test } from "bun:test";
import {
  CHAT_SHARE_FORMAT,
  CHAT_SHARE_VERSION,
  chatToShareJson,
  parseChatShare,
  shareChatFileName,
} from "./share-chat";

describe("shareChatFileName", () => {
  test("keeps words and Thai, not underscores", () => {
    const name = shareChatFileName("Session kiosk", Date.parse("2026-10-07T12:00:00Z"));
    expect(name).toBe("Mali chat - Session kiosk - 2026-10-07.mali-chat.json");
  });

  test("strips path characters only", () => {
    const name = shareChatFileName('foo/bar <test>', Date.parse("2026-01-01T00:00:00Z"));
    expect(name).toBe("Mali chat - foobar test - 2026-01-01.mali-chat.json");
  });
});

describe("share-chat", () => {
  test("round-trips", () => {
    const json = chatToShareJson({
      id: "1",
      title: "Hello",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const file = parseChatShare(json);
    expect(file.format).toBe(CHAT_SHARE_FORMAT);
    expect(file.version).toBe(CHAT_SHARE_VERSION);
    expect(file.session.title).toBe("Hello");
    expect(file.session.messages).toHaveLength(1);
  });
});
