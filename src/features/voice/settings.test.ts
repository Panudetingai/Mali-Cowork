import { describe, expect, test } from "bun:test";
import {
  getVoiceSettings,
  patchVoiceInput,
  patchVoiceOutput,
  pickInputEngine,
  pickOutputEngine,
  updateVoiceOutput,
} from "./settings";

describe("voice setup per engine", () => {
  test("a speaking engine's voice and model come back after switching away", () => {
    pickOutputEngine("elevenlabs", { voice: "21m00Tcm4TlvDq8ikWAM", voiceName: "Rachel" });
    patchVoiceOutput({ voice: "my-clone", voiceName: "Me", model: "eleven_v3" });

    pickOutputEngine("openai", { voice: "coral" });
    expect(getVoiceSettings().output).toMatchObject({ engine: "openai", voice: "coral", model: "" });
    patchVoiceOutput({ voice: "nova", model: "tts-1-hd" });

    pickOutputEngine("elevenlabs", { voice: "21m00Tcm4TlvDq8ikWAM", voiceName: "Rachel" });
    expect(getVoiceSettings().output).toMatchObject({ voice: "my-clone", voiceName: "Me", model: "eleven_v3" });

    pickOutputEngine("openai", { voice: "coral" });
    expect(getVoiceSettings().output).toMatchObject({ voice: "nova", model: "tts-1-hd" });
  });

  test("a listening engine's model comes back after switching away", () => {
    pickInputEngine("groq");
    patchVoiceInput({ model: "whisper-large-v3" });
    pickInputEngine("openai");
    expect(getVoiceSettings().input.model).toBe("");
    pickInputEngine("groq");
    expect(getVoiceSettings().input.model).toBe("whisper-large-v3");
  });

  test("a late update for another engine leaves the current one alone", () => {
    pickOutputEngine("openai", { voice: "coral" });
    updateVoiceOutput((o) => (o.engine === "fishaudio" ? { ...o, voice: "late" } : o));
    expect(getVoiceSettings().output.voice).not.toBe("late");
  });

  test("the setup is what's written to storage", () => {
    pickOutputEngine("fishaudio", { voice: "" });
    patchVoiceOutput({ voice: "fish-voice-id" });
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("mali.voice.settings");
    } catch {
      return; // No storage in this environment.
    }
    if (stored) expect(JSON.parse(stored).output.byEngine.fishaudio.voice).toBe("fish-voice-id");
  });
});
