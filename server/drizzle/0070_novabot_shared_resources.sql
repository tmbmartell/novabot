-- Private text resources, scoped to their owner and explicitly granted to Bots.
CREATE TABLE "novabot_shared_resources" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "novabot_shared_resources_owner_idx" ON "novabot_shared_resources" ("owner_user_id");
CREATE TABLE "novabot_shared_resource_grants" (
  "resource_id" text NOT NULL REFERENCES "novabot_shared_resources"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "permission" text NOT NULL,
  "granted_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "novabot_shared_resource_grants_resource_id_agent_id_pk" PRIMARY KEY ("resource_id", "agent_id"),
  CONSTRAINT "novabot_shared_resource_grants_permission_check" CHECK ("permission" IN ('read', 'write'))
);
CREATE INDEX "novabot_shared_resource_grants_agent_idx" ON "novabot_shared_resource_grants" ("agent_id");
