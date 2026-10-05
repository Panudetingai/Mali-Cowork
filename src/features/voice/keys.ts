/**
 * Keys for the voice-only services (ElevenLabs, Fish Audio). They aren't chat
 * models, so they live here rather than in Settings → Models, where they'd
 * show up in the model picker and be synced to OpenCode. Kept in the OS
 * keychain like every other key.
 */
import { bindSecrets, stripSecrets } from "@/features/secrets";
import { cleanApiKey } from "@/features/providers";
import { createStore } from "@/lib/local-store";

export type VoiceService = "elevenlabs" | "fishaudio";
type Keys = Partial<Record<VoiceService, string>>;

export const VOICE_SERVICES: Record<VoiceService, { name: string; keyUrl: string }> = {
  elevenlabs: { name: "ElevenLabs", keyUrl: "https://elevenlabs.io/app/settings/api-keys" },
  fishaudio: { name: "Fish Audio", keyUrl: "https://fish.audio/app/api-keys/" },
};

const secrets = {
  read: (keys: Keys) => Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, key?.trim() ?? ""])),
  write: (keys: Keys, values: Record<string, string>) => ({ ...keys, ...values }),
};

const store = createStore<Keys>({}, {
  key: "mali.voice.keys",
  persist: (keys) => stripSecrets(keys, secrets),
});
bindSecrets(store, { prefix: "voice:", ...secrets });

export const useVoiceKeys = store.use;

export function voiceKey(service: VoiceService): string | null {
  return store.get()[service]?.trim() || null;
}

export function setVoiceKey(service: VoiceService, key: string) {
  store.set((keys) => ({ ...keys, [service]: cleanApiKey(key) }));
}

export function isVoiceService(engine: string): engine is VoiceService {
  return engine in VOICE_SERVICES;
}
