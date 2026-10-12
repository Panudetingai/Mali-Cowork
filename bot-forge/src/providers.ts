/**
 * Where a bot's design can come from. Claude through Anthropic's own API, or
 * any server that speaks the OpenAI chat-completions API — hosted (OpenRouter,
 * Groq, DeepSeek, Gemini, Mistral, Together) or on this computer (Ollama,
 * LM Studio), so a group can pick what it can afford, down to free.
 */

export type ProviderKind = "anthropic" | "openai";

export type ProviderPreset = {
  id: string;
  label: string;
  kind: ProviderKind;
  /** OpenAI-compatible endpoints: the API root, before `/chat/completions`. */
  baseUrl?: string;
  /** The environment variable its key is read from. */
  keyEnv?: string;
  /** Runs on this computer: no key, nothing to pay. */
  local?: boolean;
  /** Used when no model is picked. Only Anthropic has one: other catalogs change too often. */
  defaultModel?: string;
  note?: string;
};

export const PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-opus-5-5",
    note: "Best designs. claude-haiku-5-5 costs a fraction of claude-opus-5-5.",
  },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", note: "Hundreds of models, some free." },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY" },
  { id: "gemini", label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY" },
  { id: "together", label: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY" },
  { id: "ollama", label: "Ollama (this computer)", kind: "openai", baseUrl: "http://localhost:11434/v1", local: true, note: "Free. Run `ollama pull <model>` first." },
  { id: "lmstudio", label: "LM Studio (this computer)", kind: "openai", baseUrl: "http://localhost:1234/v1", local: true, note: "Free. Start LM Studio's local server first." },
  { id: "custom", label: "Other (OpenAI-compatible)", kind: "openai", keyEnv: "BOT_FORGE_API_KEY", note: "Any server with /chat/completions: vLLM, LiteLLM, a company gateway…" },
];

export function preset(id: string): ProviderPreset {
  const found = PRESETS.find((p) => p.id === id.trim().toLowerCase());
  if (!found) throw new Error(`Unknown provider "${id}". Pick one of: ${PRESETS.map((p) => p.id).join(", ")}.`);
  return found;
}
