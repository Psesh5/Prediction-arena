export interface ArenaModel {
  id: string;
  name: string;
  vendor: string;
}

/** Models competing in the arena, addressed by their OpenRouter slugs. */
export const ARENA_MODELS: ArenaModel[] = [
  { id: "openai/gpt-5.4-mini", name: "GPT-5.4 mini", vendor: "OpenAI" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", vendor: "Anthropic" },
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", vendor: "Google" },
  { id: "x-ai/grok-4.3", name: "Grok 4.3", vendor: "xAI" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", vendor: "DeepSeek" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", vendor: "Meta" },
];

export function getModel(id: string): ArenaModel | undefined {
  return ARENA_MODELS.find((model) => model.id === id);
}
