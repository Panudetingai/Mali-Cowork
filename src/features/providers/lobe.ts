// Mapping from our provider id (catalog.ts) to LobeHub provider key.
// Ref: https://lobehub.com/only-ai/skills/icons/reference/providers
export const LOBE_PROVIDER_KEY: Record<string, string> = {
  ollama: "ollama",
  "ollama-cloud": "ollamacloud",
  google: "google",
  openai: "openai",
  anthropic: "anthropic",
  xai: "xai",
  // Our "Qwen" goes through Alibaba DashScope; LobeHub's Qwen icon matches.
  alibaba: "qwen",
  // Z.ai (GLM) is Zhipu.
  zai: "zhipu",
  moonshotai: "moonshot",
  deepseek: "deepseek",
  mistral: "mistral",
  openrouter: "openrouter",
  groq: "groq",
  meta: "meta",
  cohere: "cohere",
  perplexity: "perplexity",
  "black-forest-labs": "bfl",
  stability: "stability",
  midjourney: "midjourney",
  nvidia: "nvidia",
  "amazon-bedrock": "bedrock",
  azure: "azure",
  codex: "openai",
  opencode: "opencode",
};

export function lobeProviderKey(id: string): string | undefined {
  return LOBE_PROVIDER_KEY[id];
}
