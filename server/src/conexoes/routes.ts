import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { recordAuditEvent, type AuditStore } from "../audit";
import type { AppVariables } from "../auth/guards";
import type { AgentProfileStore } from "../agents/profile-store";
import { ConnectionRefusedError, type ConexoesStore } from "./store";

const createInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    origin: z.string().min(1).max(300),
  })
  .strict();
const grantInput = z
  .object({
    permission: z.enum(["view", "operate"]),
  })
  .strict();

/**
 * Private-by-default catalogue. Registering does NOT log in, run a Bot,
 * grant browser access, or assert that a session is connected.
 */
export function createConexoesRoutes(
  store: ConexoesStore,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
  profiles: Pick<AgentProfileStore, "get">,
  audit?: AuditStore,
) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireUser);
  app.use("*", bodyLimit({ maxSize: 4096 }));
  async function record(
    eventType:
      | "conexoes.application_created"
      | "conexoes.application_removed"
      | "conexoes.permission_granted"
      | "conexoes.permission_revoked",
    ownerId: string,
    id: string,
    botId?: string,
  ) {
    if (!audit) return;
    await recordAuditEvent(audit, {
      eventType,
      actorUserId: ownerId,
      targetType: "novagente_application",
      targetId: id,
      payload: botId ? { botId } : {},
    });
  }

  app.get("/", async (c) =>
    c.json({ applications: await store.list(c.var.actor.id) }),
  );
  app.post("/", async (c) => {
    const parsed = createInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Nome ou endereço inválido." }, 400);
    try {
      const application = await store.create(
        c.var.actor.id,
        parsed.data.name,
        parsed.data.origin,
      );
      await record(
        "conexoes.application_created",
        c.var.actor.id,
        application.id,
      );
      return c.json({ application }, 201);
    } catch (error) {
      if (error instanceof ConnectionRefusedError)
        return c.json({ error: error.message }, 400);
      throw error;
    }
  });
  app.delete("/:id", async (c) => {
    try {
      await store.remove(c.var.actor.id, c.req.param("id"));
      await record(
        "conexoes.application_removed",
        c.var.actor.id,
        c.req.param("id"),
      );
      return c.json({ deleted: true });
    } catch (error) {
      if (error instanceof ConnectionRefusedError)
        return c.json({ error: "Aplicação não encontrada." }, 404);
      throw error;
    }
  });
  app.get("/:id/grants", async (c) =>
    c.json({
      grants: await store.listGrants(c.var.actor.id, c.req.param("id")),
    }),
  );
  app.put("/:id/grants/:botId", async (c) => {
    const parsed = grantInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Permissão inválida." }, 400);
    const botId = c.req.param("botId");
    const actor = c.var.actor;
    const bot = await profiles.get(actor, botId);
    // Critically stricter than profiles.get alone: a shared/public Bot or
    // administrator-controlled Bot is NOT another person's private worker.
    if (
      !bot ||
      bot.deletedAt ||
      bot.systemOwned ||
      bot.ownerUserId !== actor.id
    )
      return c.json({ error: "Bot não pertence a este usuário." }, 403);
    try {
      const grant = await store.grant(
        actor.id,
        c.req.param("id"),
        botId,
        parsed.data.permission,
      );
      await record(
        "conexoes.permission_granted",
        actor.id,
        c.req.param("id"),
        botId,
      );
      return c.json({ grant });
    } catch (error) {
      if (error instanceof ConnectionRefusedError)
        return c.json({ error: "Aplicação não encontrada." }, 404);
      throw error;
    }
  });
  app.delete("/:id/grants/:botId", async (c) => {
    const result = await store.revoke(
      c.var.actor.id,
      c.req.param("id"),
      c.req.param("botId"),
    );
    if (result.revoked)
      await record(
        "conexoes.permission_revoked",
        c.var.actor.id,
        c.req.param("id"),
        c.req.param("botId"),
      );
    return c.json(result);
  });
  return app;
}
