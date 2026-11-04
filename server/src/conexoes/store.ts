import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  novagenteApplicationGrants as grants,
  novagenteApplications as apps,
} from "../db/schema";

export class ConnectionRefusedError extends Error {
  override name = "ConnectionRefusedError";
}

export function safeApplicationOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConnectionRefusedError("Informe um endereço HTTPS válido.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port !== "" ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    isIP(host) !== 0 ||
    !host.includes(".")
  ) {
    throw new ConnectionRefusedError(
      "Use apenas a origem HTTPS pública, sem senha, porta, caminho, parâmetros ou IP.",
    );
  }
  // Registrations are text metadata only. Future navigation MUST still check
  // DNS redirects, private IPs, egress policy, session ownership and consent.
  return `https://${host}`;
}

export type ConnectionPermission = "view" | "operate";
export function createConexoesStore(db: Database) {
  const owned = (ownerId: string, id: string) =>
    and(eq(apps.id, id), eq(apps.ownerUserId, ownerId));
  const summary = (row: typeof apps.$inferSelect) => ({
    id: row.id,
    name: row.name,
    origin: row.origin,
    sessionStatus: "not_connected" as const,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return {
    async list(ownerId: string) {
      const rows = await db
        .select()
        .from(apps)
        .where(eq(apps.ownerUserId, ownerId));
      return rows.map(summary);
    },
    async create(ownerId: string, name: string, rawOrigin: string) {
      const origin = safeApplicationOrigin(rawOrigin);
      if (!name.trim() || name.length > 100)
        throw new ConnectionRefusedError(
          "Informe um nome com até 100 caracteres.",
        );
      const [row] = await db
        .insert(apps)
        .values({
          id: randomUUID(),
          ownerUserId: ownerId,
          name: name.trim(),
          origin,
        })
        .returning();
      if (!row)
        throw new ConnectionRefusedError(
          "Não foi possível cadastrar a aplicação.",
        );
      return summary(row);
    },
    async remove(ownerId: string, id: string) {
      const deleted = await db
        .delete(apps)
        .where(owned(ownerId, id))
        .returning({ id: apps.id });
      if (!deleted.length)
        throw new ConnectionRefusedError("Aplicação não encontrada.");
    },
    async listGrants(ownerId: string, appId: string) {
      const rows = await db
        .select({ botId: grants.botId, permission: grants.permission })
        .from(grants)
        .innerJoin(apps, eq(apps.id, grants.applicationId))
        .where(owned(ownerId, appId));
      return rows;
    },
    async grant(
      ownerId: string,
      appId: string,
      botId: string,
      permission: ConnectionPermission,
    ) {
      // A single write tests ownership atomically, not a separate read that
      // could authorize a later write after deletion or transfer.
      const result = await db.execute(sql`
        INSERT INTO novagente_application_grants
          (application_id, bot_id, permission, granted_by)
        SELECT ${appId}, ${botId}, ${permission}, ${ownerId}
        FROM novagente_applications
        WHERE id = ${appId} AND owner_user_id = ${ownerId}
        ON CONFLICT (application_id, bot_id)
        DO UPDATE SET
          permission = EXCLUDED.permission,
          granted_by = EXCLUDED.granted_by,
          granted_at = now()
        RETURNING application_id
      `);
      if (!result.length)
        throw new ConnectionRefusedError("Aplicação não encontrada.");
      return { botId, permission };
    },
    async revoke(ownerId: string, appId: string, botId: string) {
      const result = await db.execute(sql`
        DELETE FROM novagente_application_grants g
        USING novagente_applications a
        WHERE g.application_id = a.id
          AND a.id = ${appId}
          AND a.owner_user_id = ${ownerId}
          AND g.bot_id = ${botId}
        RETURNING g.bot_id
      `);
      return { revoked: result.length > 0 };
    },
    /** Future execution gate: never trust cached permissions or an app ID. */
    async allowed(
      ownerId: string,
      appId: string,
      botId: string,
      permission: ConnectionPermission,
    ) {
      const [row] = await db
        .select({ permission: grants.permission })
        .from(grants)
        .innerJoin(apps, eq(grants.applicationId, apps.id))
        .where(and(owned(ownerId, appId), eq(grants.botId, botId)))
        .limit(1);
      return (
        row?.permission === "operate" ||
        (permission === "view" && row?.permission === "view")
      );
    },
  };
}
export type ConexoesStore = ReturnType<typeof createConexoesStore>;
