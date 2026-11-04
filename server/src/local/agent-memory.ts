import { localDatabase } from "./pg-runner";

/**
 * NovaBot: memory scoped to ONE agent and the person it works for.
 *
 * Every read, write and delete names BOTH `agent_id` and `user_id` in its WHERE clause, so one Bot
 * can never recall what another Bot stored, and never what it stored for another person. The
 * isolation is in SQL, not in a prompt.
 *
 * Recall is hybrid: semantic (pgvector cosine over multilingual-e5-small, 384 dims, computed by the
 * local `embed` container) blended with Portuguese full-text rank. When the embed service is down,
 * recall falls back to full-text only, and rows saved meanwhile are embedded on a later write.
 */
export const EMBED_DIMS = 384;
const EMBED_URL = process.env.NOVABOT_EMBED_URL?.trim() || "";

let ready: Promise<void> | undefined;
function schema() {
  const { sql, ready: base } = localDatabase();
  ready ??= base.then(async () => {
    await sql.unsafe(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS nb_agent_memory (
        id         bigserial PRIMARY KEY,
        agent_id   text NOT NULL,
        user_id    text NOT NULL,
        content    text NOT NULL,
        tsv        tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
        embedding  vector(${EMBED_DIMS}),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      DO $$ BEGIN
        IF (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'nb_agent_memory'::regclass
              AND attname = 'embedding') <> ${EMBED_DIMS} THEN
          ALTER TABLE nb_agent_memory DROP COLUMN embedding;
          ALTER TABLE nb_agent_memory ADD COLUMN embedding vector(${EMBED_DIMS});
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS nb_agent_memory_scope ON nb_agent_memory (agent_id, user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS nb_agent_memory_tsv ON nb_agent_memory USING gin (tsv);
    `);
  });
  return { sql, ready };
}

/** Embed texts with the local model; null when the service is unavailable (full-text fallback). */
export async function embed(
  texts: string[],
  kind: "query" | "passage",
): Promise<number[][] | null> {
  if (!EMBED_URL || texts.length === 0) return null;
  try {
    const response = await fetch(`${EMBED_URL}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texts, kind }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { vectors?: number[][] };
    return body.vectors?.length === texts.length ? body.vectors : null;
  } catch {
    return null;
  }
}

const literal = (vector: number[]) => `[${vector.join(",")}]`;

export async function rememberForAgent(
  agentId: string,
  userId: string,
  content: string,
) {
  const { sql, ready } = schema();
  await ready;
  const vector = (await embed([content], "passage"))?.[0];
  const [row] = vector
    ? await sql`INSERT INTO nb_agent_memory (agent_id, user_id, content, embedding)
        VALUES (${agentId}, ${userId}, ${content}, (${literal(vector)}::text)::vector) RETURNING id`
    : await sql`INSERT INTO nb_agent_memory (agent_id, user_id, content)
        VALUES (${agentId}, ${userId}, ${content}) RETURNING id`;
  void backfill(agentId, userId);
  return String(row.id);
}

/** Embed rows of this scope saved while the embed service was down. */
async function backfill(agentId: string, userId: string) {
  const { sql } = schema();
  const rows = (await sql`SELECT id::text, content FROM nb_agent_memory
    WHERE agent_id = ${agentId} AND user_id = ${userId} AND embedding IS NULL LIMIT 32`) as {
    id: string;
    content: string;
  }[];
  if (rows.length === 0) return;
  const vectors = await embed(
    rows.map((r) => r.content),
    "passage",
  );
  if (!vectors) return;
  for (const [i, r] of rows.entries()) {
    const vector = vectors[i];
    if (!vector) throw new Error("Embedding response is missing a vector.");
    await sql`UPDATE nb_agent_memory SET embedding = (${literal(vector)}::text)::vector
      WHERE id = ${r.id}::bigint AND agent_id = ${agentId} AND user_id = ${userId}`;
  }
}

export type RecalledMemory = {
  id: string;
  content: string;
  score: number;
  createdAt: string;
};

export async function recallForAgent(
  agentId: string,
  userId: string,
  query: string,
  limit = 8,
): Promise<RecalledMemory[]> {
  const { sql, ready } = schema();
  await ready;
  const q = query.trim();
  if (!q) {
    return (await sql`SELECT id::text, content, 1.0::float AS score, created_at::text AS "createdAt"
      FROM nb_agent_memory WHERE agent_id = ${agentId} AND user_id = ${userId}
      ORDER BY created_at DESC LIMIT ${limit}`) as RecalledMemory[];
  }
  const vector = (await embed([q], "query"))?.[0];
  if (vector) {
    return (await sql`
      SELECT id::text, content, created_at::text AS "createdAt",
        (CASE WHEN embedding IS NULL THEN 0 ELSE 1 - (embedding <=> (${literal(vector)}::text)::vector) END)
          + 0.3 * ts_rank(tsv, plainto_tsquery('portuguese', ${q})) AS score
      FROM nb_agent_memory
      WHERE agent_id = ${agentId} AND user_id = ${userId}
      ORDER BY score DESC, created_at DESC
      LIMIT ${limit}`) as RecalledMemory[];
  }
  return (await sql`
    SELECT id::text, content, created_at::text AS "createdAt",
      ts_rank(tsv, plainto_tsquery('portuguese', ${q})) AS score
    FROM nb_agent_memory
    WHERE agent_id = ${agentId} AND user_id = ${userId}
      AND tsv @@ plainto_tsquery('portuguese', ${q})
    ORDER BY score DESC, created_at DESC
    LIMIT ${limit}`) as RecalledMemory[];
}

export async function forgetForAgent(
  agentId: string,
  userId: string,
  id: string,
) {
  const { sql, ready } = schema();
  await ready;
  const rows = await sql`DELETE FROM nb_agent_memory
    WHERE id = ${id}::bigint AND agent_id = ${agentId} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}
