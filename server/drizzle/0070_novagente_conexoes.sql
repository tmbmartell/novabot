-- Application catalogue, restricted to owner, with no secret or session columns.
CREATE TABLE "novagente_applications" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL,
  "name" text NOT NULL,
  "origin" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "novagente_applications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX "novagente_applications_owner_origin_idx" ON "novagente_applications" USING btree ("owner_user_id", "origin");--> statement-breakpoint
CREATE INDEX "novagente_applications_owner_idx" ON "novagente_applications" USING btree ("owner_user_id");--> statement-breakpoint
CREATE TABLE "novagente_application_grants" (
  "application_id" text NOT NULL,
  "bot_id" text NOT NULL,
  "permission" text NOT NULL,
  "granted_by" text NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "novagente_application_grants_pk" PRIMARY KEY ("application_id","bot_id"),
  CONSTRAINT "novagente_application_grants_application_id_novagente_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."novagente_applications"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "novagente_application_grants_bot_id_agents_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "novagente_application_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "novagente_application_grants_permission_check" CHECK ("novagente_application_grants"."permission" IN ('view', 'operate'))
);--> statement-breakpoint
CREATE INDEX "novagente_application_grants_bot_idx" ON "novagente_application_grants" USING btree ("bot_id");
