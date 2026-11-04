/**
 * NovaBot: local runtime mode.
 *
 * When `NOVABOT_LOCAL_RUNTIME=true`, OpenBot runs WITHOUT CopilotKit Intelligence:
 * threads and run history live in this deployment's PostgreSQL (see `pg-runner.ts`), the
 * CopilotKit runtime runs in its self-hosted SSE mode, and every place that held an Intelligence
 * client holds the Postgres-backed stand-in from `local-intelligence.ts` instead.
 */
export function isLocalRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.NOVABOT_LOCAL_RUNTIME?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/** Placeholder addresses handed to code that still expects Intelligence settings. Never dialled. */
export const LOCAL_INTELLIGENCE_SETTINGS = {
  apiUrl: "http://novabot-local.invalid",
  gatewayWsUrl: "ws://novabot-local.invalid",
  apiKey: "novabot-local",
} as const;
