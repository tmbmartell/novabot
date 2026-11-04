import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents, users } from "./core";

/**
 * Owner-scoped application registry. NO browser cookies, credentials, passwords
 * or OAuth tokens live in these rows. In the initial MVP all connections are
 * unconnected, and this registry grants NO browser capabilities by itself.
 */
export const novagenteApplications = pgTable(
  "novagente_applications",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    origin: text("origin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("novagente_applications_owner_origin_idx").on(
      table.ownerUserId,
      table.origin,
    ),
    index("novagente_applications_owner_idx").on(table.ownerUserId),
  ],
);

export const novagenteApplicationGrants = pgTable(
  "novagente_application_grants",
  {
    applicationId: text("application_id")
      .notNull()
      .references(() => novagenteApplications.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    permission: text("permission").$type<"view" | "operate">().notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "novagente_application_grants_pk",
      columns: [table.applicationId, table.botId],
    }),
    index("novagente_application_grants_bot_idx").on(table.botId),
    check(
      "novagente_application_grants_permission_check",
      sql`${table.permission} IN ('view', 'operate')`,
    ),
  ],
);
