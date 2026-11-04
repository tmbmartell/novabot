/**
 * Private-by-default text resources that one person intentionally shares with
 * selected Bots in their own NovaBot installation.
 *
 * V1 deliberately does not expose browser cookies, credentials, files on disk,
 * or resources belonging to other users. A multi-customer deployment must
 * still use a separate stack per client; this is NOT cross-tenant auth.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { agents, users } from "./core";

export const sharedResources = pgTable(
  "novabot_shared_resources",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("novabot_shared_resources_owner_idx").on(table.ownerUserId),
  ],
);

export const sharedResourceGrants = pgTable(
  "novabot_shared_resource_grants",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => sharedResources.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    permission: text("permission").$type<"read" | "write">().notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.agentId] }),
    index("novabot_shared_resource_grants_agent_idx").on(table.agentId),
    check(
      "novabot_shared_resource_grants_permission_check",
      sql`${table.permission} IN ('read', 'write')`,
    ),
  ],
);
