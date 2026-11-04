import { describe, expect, test } from "bun:test";
import { credentialFormSchema } from "../src/lib/credentials/form";
import {
  MODEL_PROVIDER_PRESETS,
  modelProviderLabel,
  modelProviderPreset,
} from "../src/lib/credentials/model-provider-catalog";

describe("Provedores de IA no cofre NovaBot", () => {
  test("lista os sete provedores e informa endpoints HTTPS", () => {
    expect(Object.keys(MODEL_PROVIDER_PRESETS).sort()).toEqual(
      [
        "openai",
        "anthropic",
        "kimi",
        "minimax",
        "gemini",
        "deepseek",
        "openrouter",
      ].sort(),
    );
    for (const [id, provider] of Object.entries(MODEL_PROVIDER_PRESETS)) {
      expect(modelProviderLabel(id)).toBe(provider.label);
      expect(new URL(provider.endpoint).protocol).toBe("https:");
      expect(provider.docs.startsWith("https://")).toBe(true);
    }
  });
  test("recusa rótulos e origens arbitrárias", () => {
    expect(modelProviderPreset("gemini")?.label).toContain("Google");
    expect(modelProviderPreset("http://localhost")).toBeUndefined();
  });
  test("restringe tipos modelo, preserva conectores existentes", () => {
    for (const provider of Object.keys(MODEL_PROVIDER_PRESETS)) {
      expect(
        credentialFormSchema.safeParse({
          kind: "model",
          provider,
          keyId: "minha-chave",
          plaintext: "segredo",
        }).success,
      ).toBe(true);
    }
    expect(
      credentialFormSchema.safeParse({
        kind: "model",
        provider: "http://localhost",
        keyId: "x",
        plaintext: "segredo",
      }).success,
    ).toBe(false);
    expect(
      credentialFormSchema.safeParse({
        kind: "connector",
        provider: "conector-interno",
        keyId: "x",
        plaintext: "segredo",
      }).success,
    ).toBe(true);
  });
});
