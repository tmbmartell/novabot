import { describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  MODEL_PROVIDER_KEY_VARIABLES,
  resolveModelApiKey,
} from "../src/credentials";

const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("Provedores de modelos: cofre e isolamento de credenciais", () => {
  test("cada provedor resolve sua variável sem reutilizar chave de outro", async () => {
    const all = Object.entries(MODEL_PROVIDER_KEY_VARIABLES);
    expect(all).toHaveLength(7);
    for (const [provider, variable] of all) {
      const environment = Object.fromEntries(
        all.map(([, env], i) => [env, "secret-" + i]),
      );
      const asked: unknown[] = [];
      const result = await resolveModelApiKey({
        encryptionKey,
        provider: provider as keyof typeof MODEL_PROVIDER_KEY_VARIABLES,
        keyId: "pessoal",
        environment,
        reader: {
          readModelSecret: async (input) => {
            asked.push(input);
            return null;
          },
        },
      });
      expect(result).toBe(environment[variable]);
      expect(asked).toEqual([{ provider, keyId: "pessoal" }]);
    }
  });

  test("a chave criptografada do provedor ganha prioridade sobre a variável", async () => {
    const encryptedValue = await encryptSecret(encryptionKey, "stored-gemini");
    const result = await resolveModelApiKey({
      encryptionKey,
      provider: "gemini",
      keyId: "pessoal",
      environment: {
        GEMINI_API_KEY: "environment-gemini",
        OPENAI_API_KEY: "wrong-provider",
      },
      reader: {
        readModelSecret: async (input) => {
          expect(input).toEqual({ provider: "gemini", keyId: "pessoal" });
          return { encryptedValue };
        },
      },
    });
    expect(result).toBe("stored-gemini");
    expect(await decryptSecret(encryptionKey, encryptedValue)).toBe(
      "stored-gemini",
    );
  });

  test("não faz fallback silencioso quando a chave armazenada está corrompida", async () => {
    await expect(
      resolveModelApiKey({
        encryptionKey,
        provider: "openrouter",
        keyId: "pessoal",
        environment: { OPENROUTER_API_KEY: "environment" },
        reader: {
          readModelSecret: async () => ({ encryptedValue: "corrupt" }),
        },
      }),
    ).rejects.toThrow("Credential envelope is invalid");
  });
});
