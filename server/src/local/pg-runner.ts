import { SQL } from "bun";
import {
  type AgentRunnerRunRequest,
  InMemoryAgentRunner,
  ɵGLOBAL_STORE,
} from "@copilotkit/runtime/v2";
import type { BaseEvent, Message } from "@ag-ui/client";
import {
  defer,
  finalize,
  from,
  type Observable,
  shareReplay,
  switchMap,
} from "rxjs";

/**
 * NovaBot: the CopilotKit in-memory runner, made durable with PostgreSQL.
 *
 * Runs execute exactly as `InMemoryAgentRunner` runs them (same ownership checks, same replay on
 * connect, same local thread endpoints). After each run finishes, the thread's retained runs and
 * its message snapshot are written to `nb_threads`; at boot every stored thread is put back into the
 * runtime's process-global store, so a restart loses nothing the store had kept.
 */
type ThreadRow = {
  thread_id: string;
  owner_id: string;
  agent_id: string;
  name: string | null;
  runs: unknown;
  messages: unknown;
  created_at: Date;
};

type StoredRun = {
  runId: string;
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  createdAt: number;
};

let shared: { sql: SQL; ready: Promise<void> } | undefined;
let registered: SQL | undefined;

/**
 * Hand the server's own connection pool to the local runtime. `db/client.ts` removes
 * `DATABASE_URL` from the environment once it has opened the pool, so the pool is the only
 * address left; index.ts calls this right after `createDatabase`.
 */
export function registerLocalSql(sql: SQL): void {
  registered ??= sql;
}

export function localDatabase(url = process.env.DATABASE_URL): {
  sql: SQL;
  ready: Promise<void>;
} {
  if (shared) return shared;
  if (!registered && !url)
    throw new Error("NovaBot local runtime needs the server's database.");
  const sql = registered ?? new SQL(url as string);
  const ready = (async () => {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS nb_threads (
        thread_id  text PRIMARY KEY,
        owner_id   text NOT NULL,
        agent_id   text NOT NULL,
        name       text,
        runs       jsonb NOT NULL DEFAULT '[]'::jsonb,
        messages   jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS nb_threads_owner ON nb_threads (owner_id, updated_at DESC);
    `);
  })();
  shared = { sql, ready };
  return shared;
}

export class PostgresAgentRunner extends InMemoryAgentRunner {
  readonly #db: { sql: SQL; ready: Promise<void> };
  readonly hydrated: Promise<void>;

  constructor(db = localDatabase()) {
    super({ onConcurrentRun: "throw" });
    this.#db = db;
    this.hydrated = this.#hydrate().catch((error) => {
      console.error("[novabot] could not load stored threads:", error);
    });
  }

  async #hydrate(): Promise<void> {
    await this.#db.ready;
    const rows = (await this.#db.sql`
      SELECT thread_id, owner_id, agent_id, name, runs, messages, created_at
      FROM nb_threads ORDER BY updated_at ASC`) as ThreadRow[];
    for (const row of rows) {
      const json = <T>(value: unknown): T =>
        (typeof value === "string" ? JSON.parse(value) : value) as T;
      const runs = json<StoredRun[]>(row.runs) ?? [];
      const messages = json<Message[]>(row.messages) ?? [];
      if (ɵGLOBAL_STORE.peek(row.thread_id)) continue;
      const writer = ɵGLOBAL_STORE.getOrCreate(row.thread_id, row.owner_id);
      runs.forEach((run, index) => {
        ɵGLOBAL_STORE.appendRun(row.thread_id, writer, {
          threadId: row.thread_id,
          runId: run.runId,
          agentId: run.agentId,
          parentRunId: run.parentRunId,
          events: run.events,
          // The snapshot rides the last run, which is where appendRun takes it from.
          messages: index === runs.length - 1 ? messages : [],
          createdAt: run.createdAt,
        });
      });
    }
    console.info(
      JSON.stringify({ type: "novabot-threads-loaded", count: rows.length }),
    );
  }

  /*
   * One run per thread across every server process: before the in-memory run starts, a lease row
   * in `nb_thread_locks` is taken inside a transaction holding `pg_advisory_xact_lock`, and it is
   * released when the run ends. A thread already leased by a live run answers with an error event,
   * the same outcome as the runtime's own in-process "already running" guard.
   */
  override run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const runId = request.input.runId;
    const observable = defer(() =>
      from(acquireThreadLease(request.threadId, runId, request.ownerId ?? "")),
    ).pipe(
      switchMap(() => super.run(request)),
      finalize(() => {
        void releaseThreadLease(request.threadId, runId).catch(() => {});
      }),
      shareReplay({ refCount: false }),
    );
    const persist = () =>
      // appendRun lands on the runner's own finalize; give it a moment, then write.
      setTimeout(() => {
        void this.persist(request.threadId, request.ownerId ?? "").catch(
          (error) =>
            console.error(
              "[novabot] could not store thread",
              request.threadId,
              error,
            ),
        );
      }, 250);
    observable.subscribe({ complete: persist, error: persist });
    return observable;
  }

  async persist(threadId: string, ownerHint: string): Promise<void> {
    const store = ɵGLOBAL_STORE.peek(threadId);
    if (!store) return;
    await this.#db.ready;
    const runs: StoredRun[] = store.historicRuns.map((run) => ({
      runId: run.runId,
      agentId: run.agentId,
      parentRunId: run.parentRunId,
      events: run.events,
      createdAt: run.createdAt,
    }));
    const agentId = runs.at(-1)?.agentId ?? "";
    const owner = store.ownerId || ownerHint;
    await this.#db.sql`
      INSERT INTO nb_threads (thread_id, owner_id, agent_id, runs, messages, updated_at)
      VALUES (${threadId}, ${owner}, ${agentId}, (${JSON.stringify(runs)}::text)::jsonb,
              (${JSON.stringify(store.messagesSnapshot)}::text)::jsonb, now())
      ON CONFLICT (thread_id) DO UPDATE SET
        agent_id = EXCLUDED.agent_id, runs = EXCLUDED.runs,
        messages = EXCLUDED.messages, updated_at = now()`;
  }
}

let runner: PostgresAgentRunner | undefined;
/** One runner per process: the runtime, routines and handoffs share it, like the global store. */
export function localRunner(): PostgresAgentRunner {
  runner ??= new PostgresAgentRunner();
  return runner;
}

/* ---- Postgres thread leases (advisory lock + lease row) ---- */
const LEASE_SECONDS = 600;
let leasesReady: Promise<void> | undefined;
function leases() {
  const db = localDatabase();
  leasesReady ??= db.ready.then(async () => {
    await db.sql.unsafe(`CREATE TABLE IF NOT EXISTS nb_thread_locks (
      thread_id  text PRIMARY KEY,
      run_id     text NOT NULL,
      user_id    text NOT NULL,
      expires_at timestamptz NOT NULL
    )`);
  });
  return { sql: db.sql, ready: leasesReady };
}

export class ThreadLeasedError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} is already running in another process.`);
    this.name = "ThreadLeasedError";
  }
}

export async function acquireThreadLease(
  threadId: string,
  runId: string,
  userId: string,
  ttl = LEASE_SECONDS,
) {
  const { sql, ready } = leases();
  await ready;
  const ok = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${threadId}))`;
    const rows = await tx`
      INSERT INTO nb_thread_locks (thread_id, run_id, user_id, expires_at)
      VALUES (${threadId}, ${runId}, ${userId}, now() + make_interval(secs => ${ttl}))
      ON CONFLICT (thread_id) DO UPDATE
        SET run_id = EXCLUDED.run_id, user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at
        WHERE nb_thread_locks.expires_at < now() OR nb_thread_locks.run_id = EXCLUDED.run_id
      RETURNING run_id`;
    return rows.length > 0;
  });
  if (!ok) throw new ThreadLeasedError(threadId);
}

export async function renewThreadLease(
  threadId: string,
  runId: string | undefined,
  ttl = LEASE_SECONDS,
) {
  const { sql, ready } = leases();
  await ready;
  return (await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${threadId}))`;
    return runId
      ? tx`UPDATE nb_thread_locks SET expires_at = now() + make_interval(secs => ${ttl})
           WHERE thread_id = ${threadId} AND run_id = ${runId} RETURNING run_id`
      : tx`UPDATE nb_thread_locks SET expires_at = now() + make_interval(secs => ${ttl})
           WHERE thread_id = ${threadId} RETURNING run_id`;
  })) as { run_id: string }[];
}

export async function releaseThreadLease(threadId: string, runId?: string) {
  const { sql, ready } = leases();
  await ready;
  await (runId
    ? sql`DELETE FROM nb_thread_locks WHERE thread_id = ${threadId} AND run_id = ${runId}`
    : sql`DELETE FROM nb_thread_locks WHERE thread_id = ${threadId}`);
}
