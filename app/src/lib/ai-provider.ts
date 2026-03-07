import type { AiProvider, Config } from "./config";

export const AI_PROVIDER_ORDER: AiProvider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
};

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4.1",
  google: "gemini-2.5-pro",
  openrouter: "openai/gpt-4.1",
};

export function isAiProvider(value: string): value is AiProvider {
  return AI_PROVIDER_ORDER.includes(value as AiProvider);
}

export function getAiProviderLabel(provider: AiProvider): string {
  return AI_PROVIDER_LABELS[provider];
}

export function getConfiguredAiModel(config: Config): string {
  switch (config.aiProvider) {
    case "openai":
      return config.openaiModel;
    case "google":
      return config.googleModel;
    case "openrouter":
      return config.openrouterModel;
    case "anthropic":
    default:
      return config.anthropicModel;
  }
}

export function getConfiguredAiProviderLabel(config: Config): string {
  return getAiProviderLabel(config.aiProvider);
}
