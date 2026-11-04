import { randomUUID } from "node:crypto";
import {
  type CopilotKitIntelligence,
  PlatformRequestError,
  ɵGLOBAL_STORE,
} from "@copilotkit/runtime/v2";
import { LOCAL_INTELLIGENCE_SETTINGS } from "./mode";
import {
  acquireThreadLease,
  localDatabase,
  localRunner,
  releaseThreadLease,
  renewThreadLease,
  ThreadLeasedError,
} from "./pg-runner";

/**
 * NovaBot: a Postgres-backed stand-in for the CopilotKit Intelligence client.
 *
 * OpenBot passes one Intelligence client to many places (thread lookups, run locks, routines,
 * handoffs, memory, learning, the self-host banner). In local mode each of those gets this object
 * instead. What it answers:
 *  - threads: from the runtime's thread store, which `PostgresAgentRunner` keeps durable;
 *  - run locks: one run per thread, a lease row in Postgres guarded by an advisory lock;
 *  - memory / learning / entitlements: refused with a 503, which OpenBot already treats as
 *    "Intelligence unavailable" and falls back to its own Postgres memory store (`memory/store.ts`).
 * Anything else is refused the same way rather than silently pretending to work.
 */
type Thread = {
  id: string;
  name: string | null;
  agentId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

const created = new Map<string, Thread>();
function unavailable(what: string): never {
  throw new PlatformRequestError(
    `${what} is not available in NovaBot local mode.`,
    503,
    false,
  );
}

function threadSummary(threadId: string, userId: string): Thread | undefined {
  const store = ɵGLOBAL_STORE.peek(threadId);
  if (store) {
    if (store.ownerId && userId && store.ownerId !== userId) return undefined;
    const last = store.historicRuns.at(-1);
    const at = new Date(
      last?.createdAt ?? store.createdAt ?? Date.now(),
    ).toISOString();
    return {
      id: threadId,
      name: created.get(threadId)?.name ?? null,
      agentId: last?.agentId ?? created.get(threadId)?.agentId ?? "",
      createdById: store.ownerId,
      createdAt: new Date(store.createdAt ?? Date.now()).toISOString(),
      updatedAt: at,
    };
  }
  const minted = created.get(threadId);
  if (minted && (!userId || minted.createdById === userId)) return minted;
  return undefined;
}

export function createLocalIntelligence(): CopilotKitIntelligence {
  // Make sure the tables exist and stored threads are loaded before the first answer.
  const runner = localRunner();
  void localDatabase().ready;

  const implemented: Record<string, (...args: never[]) => unknown> = {
    async getThread(params: { threadId: string; userId: string }) {
      await runner.hydrated;
      const thread = threadSummary(params.threadId, params.userId);
      if (!thread)
        throw new PlatformRequestError("Thread not found", 404, false);
      return {
        ...thread,
        lastRunAt: thread.updatedAt,
        lastUpdatedAt: thread.updatedAt,
      };
    },
    async getOrCreateThread(params: {
      threadId: string;
      userId: string;
      agentId: string;
      name?: string;
    }) {
      await runner.hydrated;
      const existing = threadSummary(params.threadId, params.userId);
      if (existing) return { thread: existing, created: false };
      if (ɵGLOBAL_STORE.peek(params.threadId))
        throw new PlatformRequestError(
          "Thread belongs to someone else",
          403,
          false,
        );
      const now = new Date().toISOString();
      const thread: Thread = {
        id: params.threadId,
        name: params.name ?? null,
        agentId: params.agentId,
        createdById: params.userId,
        createdAt: now,
        updatedAt: now,
      };
      created.set(params.threadId, thread);
      return { thread, created: true };
    },
    async createThread(params: {
      threadId: string;
      userId: string;
      agentId: string;
      name?: string;
    }) {
      if (!implemented.getOrCreateThread) {
        throw new Error("Thread creation is unavailable.");
      }
      const result = (await implemented.getOrCreateThread(params as never)) as {
        thread: Thread;
      };
      return result.thread;
    },
    async getThreadMessages(params: { threadId: string; userId: string }) {
      await runner.hydrated;
      if (!threadSummary(params.threadId, params.userId))
        return { messages: [] };
      return {
        messages: runner.getThreadMessages(params.threadId, {
          ownerId: params.userId,
        }),
      };
    },
    /*
     * Run locks live in Postgres (nb_thread_locks), so they hold across server restarts and across
     * more than one server process. Each acquire/renew runs in a transaction that first takes
     * `pg_advisory_xact_lock(hashtext(thread_id))`, which serialises competing runs on the same
     * thread; the row is the lease (run id + expiry) that outlives the transaction.
     */
    // Same Postgres leases the runner takes (pg-runner.ts): advisory lock + lease row.
    async ɵacquireThreadLock(params: {
      threadId: string;
      runId: string;
      userId: string;
    }) {
      try {
        await acquireThreadLease(
          params.threadId,
          params.runId,
          params.userId,
          120,
        );
      } catch (error) {
        if (error instanceof ThreadLeasedError)
          throw new PlatformRequestError(
            "Thread is already running",
            409,
            true,
            "thread_locked",
          );
        throw error;
      }
      return {
        threadId: params.threadId,
        runId: params.runId,
        joinToken: randomUUID(),
        ttlSeconds: 120,
      };
    },
    async ɵrenewThreadLock(params: {
      threadId: string;
      runId?: string;
      ttlSeconds?: number;
    }) {
      const ttl = params.ttlSeconds ?? 120;
      const rows = await renewThreadLease(params.threadId, params.runId, ttl);
      if (rows.length === 0)
        return {
          ttlSeconds: 0,
          status: "completed",
          threadId: params.threadId,
        };
      const lease = rows[0];
      if (!lease) throw new Error("Lease renewal returned no row.");
      return {
        ttlSeconds: ttl,
        status: "renewed",
        threadId: params.threadId,
        runId: lease.run_id,
      };
    },
    async ɵcleanupThreadLock(params: { threadId: string; runId?: string }) {
      await releaseThreadLease(params.threadId, params.runId);
    },
    ɵgetRunnerWsUrl: () => `${LOCAL_INTELLIGENCE_SETTINGS.gatewayWsUrl}/runner`,
    ɵgetRunnerAuthToken: () => LOCAL_INTELLIGENCE_SETTINGS.apiKey,
    ɵgetClientWsUrl: () => `${LOCAL_INTELLIGENCE_SETTINGS.gatewayWsUrl}/client`,
    ɵgetChannelsWsUrl: () =>
      `${LOCAL_INTELLIGENCE_SETTINGS.gatewayWsUrl}/channels`,
    async getInspectorMetadata() {
      return undefined;
    },
  };

  return new Proxy({} as CopilotKitIntelligence, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      if (property === "then") return undefined;
      const own = implemented[property];
      if (own) return own;
      if (property.startsWith("on")) return () => () => {}; // event subscriptions: nothing fires
      return async () => unavailable(`Intelligence.${property}`);
    },
  });
}
