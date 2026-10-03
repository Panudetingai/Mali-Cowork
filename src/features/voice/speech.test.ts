import { describe, expect, test } from "bun:test";
import { speakable } from "./speech";

describe("what a reply sounds like read aloud", () => {
  test("no code, marks or links — the words only", () => {
    const reply = "## Done\n\n**Saved** the [report](https://x.com/r) to `~/Desktop`.\n\n```bash\nrm -rf /\n```\n- one\n- two";
    expect(speakable(reply)).toBe("Done Saved the report to ~/Desktop. one two");
  });

  test("tables and pictures are left out", () => {
    expect(speakable("Here:\n| a | b |\n|---|---|\n| 1 | 2 |\n![chart](a.png)\nThat's all.")).toBe("Here: That's all.");
  });

  test("a long reply is cut at a sentence's end", () => {
    const spoken = speakable("This is one sentence. ".repeat(60));
    expect(spoken.length).toBeLessThanOrEqual(701);
    expect(spoken.endsWith("sentence.…")).toBe(true);
  });

  test("text with no sentence ends (Thai) is cut between words", () => {
    const spoken = speakable("คำ ".repeat(400));
    expect(spoken.endsWith("คำ…")).toBe(true);
  });
});
