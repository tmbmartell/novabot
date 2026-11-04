/**
 * Presets for admin API-key registration (not proof that a Bot is connected).
 * Key material is encrypted and stored by the existing server-side vault.
 */
export const MODEL_PROVIDER_PRESETS = {
  openai: {
    label: "OpenAI",
    protocol: "API OpenAI",
    endpoint: "https://api.openai.com/v1",
    docs: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Claude (Anthropic)",
    protocol: "API Anthropic",
    endpoint: "https://api.anthropic.com/v1",
    docs: "https://console.anthropic.com/settings/keys",
  },
  kimi: {
    label: "Kimi (Moonshot AI)",
    protocol: "Compatível com OpenAI",
    endpoint: "https://api.moonshot.ai/v1",
    docs: "https://platform.moonshot.ai/",
  },
  minimax: {
    label: "MiniMax",
    protocol: "Compatível com OpenAI",
    endpoint: "https://api.minimax.io/v1",
    docs: "https://platform.minimax.io/",
  },
  gemini: {
    label: "Gemini (Google)",
    protocol: "Compatível com OpenAI",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/",
    docs: "https://aistudio.google.com/apikey",
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "Compatível com OpenAI",
    endpoint: "https://api.deepseek.com",
    docs: "https://platform.deepseek.com/api_keys",
  },
  openrouter: {
    label: "OpenRouter",
    protocol: "Compatível com OpenAI",
    endpoint: "https://openrouter.ai/api/v1",
    docs: "https://openrouter.ai/settings/keys",
  },
} as const;

export type ModelProviderPresetId = keyof typeof MODEL_PROVIDER_PRESETS;

export const MODEL_PROVIDER_OPTIONS: Record<ModelProviderPresetId, string> =
  Object.fromEntries(
    Object.entries(MODEL_PROVIDER_PRESETS).map(([id, preset]) => [
      id,
      preset.label,
    ]),
  ) as Record<ModelProviderPresetId, string>;

export function modelProviderPreset(id: string) {
  return Object.hasOwn(MODEL_PROVIDER_PRESETS, id)
    ? MODEL_PROVIDER_PRESETS[id as ModelProviderPresetId]
    : undefined;
}
export function modelProviderLabel(id: string) {
  return modelProviderPreset(id)?.label ?? id;
}
export function isModelProviderPresetId(
  id: string,
): id is ModelProviderPresetId {
  return Object.hasOwn(MODEL_PROVIDER_PRESETS, id);
}
