// Provider ids must match `provider_info` in src-tauri/src/ai/mod.rs.

export type ProviderDef = {
  id: string;
  name: string;
  description: string;
  /** models.dev logo id. */
  logo: string;
  group: "local" | "cloud";
  defaultBaseUrl: string;
  /** Comma-separated model ids suggested for a fresh config. */
  defaultModels: string;
  keyRequired: boolean;
  envVar?: string;
  /**
   * Token budget per request. When a chat would exceed it, the conversation
   * continues in a new chat instead of failing (e.g. Groq's free-tier TPM cap).
   */
  contextLimit?: number;
  /** Where to get an API key. */
  keyUrl?: string;
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "ollama",
    name: "Ollama",
    description: "Models running on this machine through Ollama.",
    logo: "ollama",
    group: "local",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModels: "",
    keyRequired: false,
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    description: "Large open models hosted by Ollama — no GPU needed.",
    logo: "ollama-cloud",
    group: "cloud",
    defaultBaseUrl: "https://ollama.com/v1",
    defaultModels: "gpt-oss:120b",
    keyRequired: true,
    envVar: "OLLAMA_API_KEY",
    keyUrl: "https://ollama.com/settings/keys",
  },
  {
    id: "google",
    name: "Gemini",
    description: "Google Gemini model configuration.",
    logo: "google",
    group: "cloud",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModels: "gemini-2.5-flash",
    keyRequired: true,
    envVar: "GOOGLE_API_KEY",
    keyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI model configuration.",
    logo: "openai",
    group: "cloud",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: "gpt-4o",
    keyRequired: true,
    envVar: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Anthropic Claude model configuration.",
    logo: "anthropic",
    group: "cloud",
    defaultBaseUrl: "https://api.anthropic.com/v1/",
    defaultModels: "claude-sonnet-5, claude-opus-5",
    keyRequired: true,
    envVar: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "xai",
    name: "Grok",
    description: "xAI Grok model configuration.",
    logo: "xai",
    group: "cloud",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModels: "grok-4",
    keyRequired: true,
    envVar: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
  },
  {
    id: "alibaba",
    name: "Qwen",
    description: "Alibaba Qwen models through DashScope.",
    logo: "alibaba",
    group: "cloud",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModels: "qwen-plus",
    keyRequired: true,
    envVar: "DASHSCOPE_API_KEY",
    keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
  },
  {
    id: "zai",
    name: "Z.ai",
    description: "Z.ai GLM model configuration.",
    logo: "zai",
    group: "cloud",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    defaultModels: "glm-4.6",
    keyRequired: true,
    envVar: "ZAI_API_KEY",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
  },
  {
    id: "moonshotai",
    name: "Moonshot",
    description: "Moonshot Kimi model configuration.",
    logo: "moonshotai",
    group: "cloud",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModels: "kimi-k2-0905-preview",
    keyRequired: true,
    envVar: "MOONSHOT_API_KEY",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
  },
  {
    id: "deepseek",
    name: "Deepseek",
    description: "DeepSeek model configuration.",
    logo: "deepseek",
    group: "cloud",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModels: "deepseek-chat",
    keyRequired: true,
    envVar: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "mistral",
    name: "Mistral",
    description: "Mistral AI model configuration.",
    logo: "mistral",
    group: "cloud",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModels: "mistral-large-latest",
    keyRequired: true,
    envVar: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Hundreds of models behind one OpenRouter key.",
    logo: "openrouter",
    group: "cloud",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModels: "z-ai/glm-5.2:free",
    keyRequired: true,
    envVar: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Fast inference on Groq.",
    logo: "groq",
    group: "cloud",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModels: "openai/gpt-oss-120b",
    keyRequired: true,
    envVar: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    // Free tier allows 6K–12K tokens per minute depending on the model.
    contextLimit: 8000,
  },
];

export function getProvider(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}

export function splitModels(models: string) {
  return [...new Set(models.split(",").map((m) => m.trim()).filter(Boolean))];
}
