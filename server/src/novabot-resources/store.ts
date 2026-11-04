import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  sharedResourceGrants as grants,
  sharedResources as resources,
} from "../db/schema";

export const RESOURCE_TITLE_LIMIT = 120;
export const RESOURCE_CONTENT_LIMIT = 16_000;

export class ResourceRefusedError extends Error {
  override name = "ResourceRefusedError";
}

function validate(title: string, content: string) {
  if (!title.trim() || title.length > RESOURCE_TITLE_LIMIT) {
    throw new ResourceRefusedError("Title must have 1 to 120 characters.");
  }
  if (content.length > RESOURCE_CONTENT_LIMIT) {
    throw new ResourceRefusedError(
          "Content exceeds the 16,000-character limit.",
        );
  }
}

function mapResource(row: typeof resources.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The person owns the content. A Bot gets only an explicit grant for this person. */
export function createSharedResourceStore(database: Database) {
  const owned = (ownerId: string, id: string) =>
    and(eq(resources.id, id), eq(resources.ownerUserId, ownerId));

  const botScope = (ownerId: string, botId: string) =>
    and(
      eq(resources.ownerUserId, ownerId),
      eq(grants.agentId, botId),
      eq(resources.id, grants.resourceId),
    );

  async function ownerHas(ownerId: string, id: string) {
    const [found] = await database
      .select({ id: resources.id })
      .from(resources)
      .where(owned(ownerId, id))
      .limit(1);
    if (!found) throw new ResourceRefusedError("Resource not found.");
  }

  return {
    async create(ownerId: string, title: string, content: string) {
      validate(title, content);
      const [created] = await database
        .insert(resources)
        .values({
          id: randomUUID(),
          ownerUserId: ownerId,
          title: title.trim(),
          content,
        })
        .returning();
      if (!created)
        throw new ResourceRefusedError("Could not create resource.");
      return mapResource(created);
    },
    async listOwned(ownerId: string) {
      return (
        await database
          .select()
          .from(resources)
          .where(eq(resources.ownerUserId, ownerId))
      ).map(mapResource);
    },
    async readOwned(ownerId: string, id: string) {
      const [row] = await database
        .select()
        .from(resources)
        .where(owned(ownerId, id))
        .limit(1);
      if (!row) throw new ResourceRefusedError("Resource not found.");
      return mapResource(row);
    },
    async updateOwned(
      ownerId: string,
      id: string,
      title: string,
      content: string,
    ) {
      validate(title, content);
      const [row] = await database
        .update(resources)
        .set({ title: title.trim(), content, updatedAt: new Date() })
        .where(owned(ownerId, id))
        .returning();
      if (!row) throw new ResourceRefusedError("Resource not found.");
      return mapResource(row);
    },
    async removeOwned(ownerId: string, id: string) {
      const removed = await database
        .delete(resources)
        .where(owned(ownerId, id))
        .returning({ id: resources.id });
      if (removed.length === 0)
        throw new ResourceRefusedError("Resource not found.");
    },
    async grantsFor(ownerId: string, id: string) {
      await ownerHas(ownerId, id);
      return database
        .select({
          botId: grants.agentId,
          permission: grants.permission,
          grantedAt: grants.createdAt,
        })
        .from(grants)
        .where(eq(grants.resourceId, id));
    },
    async grant(
      ownerId: string,
      id: string,
      botId: string,
      permission: "read" | "write",
    ) {
      if (permission !== "read" && permission !== "write") {
        throw new ResourceRefusedError("Invalid permission.");
      }
      // Single SQL insert guarded by ownership; a concurrent delete cannot
      // create an orphan grant. The FK separately verifies that the Bot exists.
      const inserted = await database.execute(sql`
        INSERT INTO novabot_shared_resource_grants
          (resource_id, agent_id, permission, granted_by)
        SELECT ${id}, ${botId}, ${permission}, ${ownerId}
        FROM novabot_shared_resources
        WHERE id = ${id} AND owner_user_id = ${ownerId}
        ON CONFLICT (resource_id, agent_id) DO UPDATE
        SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by
        RETURNING resource_id
      `);
      if (inserted.length === 0)
        throw new ResourceRefusedError("Resource not found.");
      return { botId, permission };
    },
    async revoke(ownerId: string, id: string, botId: string) {
      await ownerHas(ownerId, id);
      await database
        .delete(grants)
        .where(and(eq(grants.resourceId, id), eq(grants.agentId, botId)));
    },
    async listForBot(ownerId: string, botId: string) {
      const rows = await database
        .select({
          id: resources.id,
          title: resources.title,
          permission: grants.permission,
          updatedAt: resources.updatedAt,
        })
        .from(resources)
        .innerJoin(grants, eq(resources.id, grants.resourceId))
        .where(botScope(ownerId, botId));
      return rows;
    },
    async readForBot(ownerId: string, botId: string, id: string) {
      const [row] = await database
        .select({
          id: resources.id,
          title: resources.title,
          content: resources.content,
        })
        .from(resources)
        .innerJoin(grants, eq(resources.id, grants.resourceId))
        .where(and(botScope(ownerId, botId), eq(resources.id, id)))
        .limit(1);
      if (!row)
        throw new ResourceRefusedError("Resource not found or not granted.");
      return row;
    },
    async writeForBot(
      ownerId: string,
      botId: string,
      id: string,
      content: string,
    ) {
      if (content.length > RESOURCE_CONTENT_LIMIT) {
        throw new ResourceRefusedError(
          "Content exceeds the 16,000-character limit.",
        );
      }
      // The permission is checked INSIDE the UPDATE statement to ensure that
      // revocation taking effect before this write cannot be bypassed.
      const [row] = await database
        .update(resources)
        .set({ content, updatedAt: new Date() })
        .where(
          and(
            owned(ownerId, id),
            sql`EXISTS (SELECT 1 FROM novabot_shared_resource_grants AS g
            WHERE g.resource_id = ${resources.id}
              AND g.agent_id = ${botId} AND g.permission = 'write')`,
          ),
        )
        .returning({ id: resources.id, updatedAt: resources.updatedAt });
      if (!row)
        throw new ResourceRefusedError(
          "Resource not found or write not granted.",
        );
      return row;
    },
  };
}

export type SharedResourceStore = ReturnType<typeof createSharedResourceStore>;
