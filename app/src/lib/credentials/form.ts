import { z } from "zod";
import { isModelProviderPresetId } from "./model-provider-catalog";

export const credentialFormSchema = z
  .object({
    kind: z.enum(["model", "connector"]),
    provider: z.string().trim().min(1, "O provedor é obrigatório."),
    keyId: z.string().trim().min(1, "O ID da chave é obrigatório."),
    plaintext: z.string().min(1, "O segredo é obrigatório."),
  })
  .refine(
    ({ kind, provider }) =>
      kind !== "model" || isModelProviderPresetId(provider),
    { path: ["provider"], message: "Selecione um provedor de IA da lista." },
  );

export type CredentialFormValues = z.infer<typeof credentialFormSchema>;
