/** Provider logo id (catalog / models.dev) inferred from a model id string. */
export function brandLogoForModelName(modelName: string, fallback: string) {
  return inferBrandLogo(modelName) ?? fallback;
}

function inferBrandLogo(raw: string): string | undefined {
  const slug = raw.toLowerCase();
  const tail = slug.includes("/") ? slug.split("/").pop()! : slug;

  if (/claude|anthropic/.test(slug)) return "anthropic";
  if (/^(gpt|chatgpt|o[0-9]|sora|dall-e|gpt-image|text-embedding)/.test(tail) || /^gpt/.test(tail)) return "openai";
  if (/gemini|veo|imagen|palm|bard/.test(slug)) return "google";
  if (/antigravity/.test(slug)) return "antigravity";
  if (/cursor|composer/.test(slug)) return "cursor";
  if (/^qwen|\/qwen|wan2|wan-/.test(slug)) return "alibaba";
  if (/grok|x-ai|xai/.test(slug)) return "xai";
  if (/^ollama\//.test(slug)) return "ollama";
  if (/^ollama-cloud\/|ollama-cloud\//.test(slug)) return "ollama-cloud";
  if (/deepseek/.test(slug)) return "deepseek";
  if (/mistral|mixtral|codestral|pixtral|ministral/.test(slug)) return "mistral";
  if (/llama|meta-llama|\bllama\b/.test(slug)) return "meta";
  if (/glm|zhipu|z-ai|zai/.test(slug)) return "zai";
  if (/moonshot|kimi|moss/.test(slug)) return "moonshotai";
  if (/groq/.test(slug)) return "groq";
  if (/cohere|command-r/.test(slug)) return "cohere";
  if (/perplexity|sonar/.test(slug)) return "perplexity";
  if (/flux|black-forest/.test(slug)) return "black-forest-labs";
  if (/stable-diffusion|stability|sdxl/.test(slug)) return "stability";
  if (/midjourney/.test(slug)) return "midjourney";
  if (/nvidia|nemotron/.test(slug)) return "nvidia";
  if (/amazon|bedrock|nova/.test(slug)) return "amazon-bedrock";
  if (/microsoft|phi-|azure/.test(slug)) return "azure";
  if (/muse-spark|composer|claude-fable|claude-opus|claude-sonnet|gpt-5\.|gemini-/.test(tail)) {
    if (/claude|fable|opus|sonnet/.test(tail)) return "anthropic";
    if (/gpt|composer|o[0-9]/.test(tail)) return "openai";
    if (/gemini|muse-spark/.test(tail)) return "google";
    if (/grok/.test(tail)) return "xai";
  }
  return undefined;
}
