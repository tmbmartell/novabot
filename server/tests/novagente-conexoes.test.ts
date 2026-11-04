import { describe, expect, it } from "bun:test";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { createConexoesRoutes } from "../src/conexoes/routes";
import {
  ConnectionRefusedError,
  safeApplicationOrigin,
  type ConexoesStore,
} from "../src/conexoes/store";

const id = "0a1e0000-0000-4000-8000-000000000001";
function fixture() {
  const applications = new Map<
    string,
    { owner: string; name: string; origin: string }
  >([[id, { owner: "alice", name: "CRM", origin: "https://crm.example.com" }]]);
  const grants = new Map<string, "view" | "operate">();
  const check = (owner: string, appId: string) => {
    if (applications.get(appId)?.owner !== owner)
      throw new ConnectionRefusedError("not found");
  };
  const store = {
    list: async (owner: string) =>
      [...applications.entries()]
        .filter(([, app]) => app.owner === owner)
        .map(([appId, app]) => ({
          id: appId,
          name: app.name,
          origin: app.origin,
          sessionStatus: "not_connected",
        })),
    create: async (owner: string, name: string, origin: string) => {
      const url = safeApplicationOrigin(origin);
      applications.set("new", { owner, name, origin: url });
      return { id: "new", name, origin: url, sessionStatus: "not_connected" };
    },
    remove: async (owner: string, appId: string) => {
      check(owner, appId);
      applications.delete(appId);
    },
    listGrants: async (owner: string, appId: string) => {
      if (applications.get(appId)?.owner !== owner) return [];
      return [...grants.entries()].map(([botId, permission]) => ({
        botId,
        permission,
      }));
    },
    grant: async (
      owner: string,
      appId: string,
      botId: string,
      permission: "view" | "operate",
    ) => {
      check(owner, appId);
      grants.set(botId, permission);
      return { botId, permission };
    },
    revoke: async (owner: string, appId: string, botId: string) => {
      if (applications.get(appId)?.owner !== owner) return { revoked: false };
      return { revoked: grants.delete(botId) };
    },
    allowed: async (
      owner: string,
      appId: string,
      botId: string,
      requested: "view" | "operate",
    ) => {
      if (applications.get(appId)?.owner !== owner) return false;
      const value = grants.get(botId);
      return value === "operate" || (value === "view" && requested === "view");
    },
  } as unknown as ConexoesStore;
  const user: MiddlewareHandler<{ Variables: AppVariables }> = async (
    c,
    next,
  ) => {
    const name = c.req.header("x-test-user");
    if (!name) return c.json({ error: "Authentication required." }, 401);
    c.set("actor", { id: name, email: name + "@example.test", role: "admin" });
    await next();
  };
  const profiles = {
    get: async (_actor: { id: string }, botId: string) =>
      botId === "alice-bot"
        ? {
            id: botId,
            ownerUserId: "alice",
            deletedAt: null,
            systemOwned: false,
          }
        : botId === "system-bot"
          ? {
              id: botId,
              ownerUserId: null,
              deletedAt: null,
              systemOwned: true,
            }
          : botId === "bob-bot"
            ? {
                id: botId,
                ownerUserId: "bob",
                deletedAt: null,
                systemOwned: false,
              }
            : null,
  };
  const app = new Hono();
  app.route(
    "/api/conexoes",
    createConexoesRoutes(store, user, profiles as never),
  );
  function request(
    path: string,
    method = "GET",
    actor = "alice",
    body?: unknown,
  ) {
    return app.request("/api/conexoes" + (path === "/" ? "" : path), {
      method,
      headers: {
        ...(actor ? { "x-test-user": actor } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  return { request, store, grants };
}

describe("NOVAGENTE Conexões MVP 1", () => {
  it("rejects requests without an authenticated actor", async () => {
    expect((await fixture().request("/", "GET", "")).status).toBe(401);
  });
  it("lists only the owner's apps, never another person's even for admins", async () => {
    const f = fixture();
    expect(
      (await (await f.request("/", "GET", "bob")).json()).applications,
    ).toEqual([]);
    expect((await f.request("/" + id, "DELETE", "bob")).status).toBe(404);
    expect(
      (
        await f.request("/" + id + "/grants/alice-bot", "PUT", "bob", {
          permission: "operate",
        })
      ).status,
    ).toBe(403);
  });
  it("rejects public, system-owned and other users' bots", async () => {
    const f = fixture();
    for (const botId of ["system-bot", "bob-bot", "nonexistent"]) {
      expect(
        (
          await f.request("/" + id + "/grants/" + botId, "PUT", "alice", {
            permission: "operate",
          })
        ).status,
      ).toBe(403);
    }
    expect(f.grants.size).toBe(0);
  });
  it("defaults to deny and enforces read versus operate and revocation", async () => {
    const f = fixture();
    expect(await f.store.allowed("alice", id, "alice-bot", "view")).toBe(false);
    expect(
      (
        await f.request("/" + id + "/grants/alice-bot", "PUT", "alice", {
          permission: "view",
        })
      ).status,
    ).toBe(200);
    expect(await f.store.allowed("alice", id, "alice-bot", "view")).toBe(true);
    expect(await f.store.allowed("alice", id, "alice-bot", "operate")).toBe(
      false,
    );
    expect(
      (
        await f.request("/" + id + "/grants/alice-bot", "PUT", "alice", {
          permission: "operate",
        })
      ).status,
    ).toBe(200);
    expect(await f.store.allowed("alice", id, "alice-bot", "operate")).toBe(
      true,
    );
    expect(
      (await f.request("/" + id + "/grants/alice-bot", "DELETE")).status,
    ).toBe(200);
    expect(await f.store.allowed("alice", id, "alice-bot", "view")).toBe(false);
    expect(await f.store.allowed("bob", id, "alice-bot", "operate")).toBe(
      false,
    );
  });
  it("never claims login is complete from a registration", async () => {
    const f = fixture();
    const r = await f.request("/", "POST", "alice", {
      name: "Instagram",
      origin: "https://www.instagram.com/",
      sessionStatus: "connected",
    });
    expect(r.status).toBe(400);
    const accepted = await f.request("/", "POST", "alice", {
      name: "Instagram",
      origin: "https://www.instagram.com/",
    });
    expect(accepted.status).toBe(201);
    expect((await accepted.json()).application.sessionStatus).toBe(
      "not_connected",
    );
  });
  it("rejects unsafe URLs and invalid grant types", async () => {
    const f = fixture();
    for (const url of [
      "http://example.com",
      "https://localhost",
      "https://127.0.0.1",
      "https://192.168.0.1",
      "https://example.com:444",
      "https://user:password@example.com",
      "https://example.com/path",
      "https://example.com/?token=secret",
      "https://example.internal",
      "javascript:alert(1)",
    ]) {
      expect(() => safeApplicationOrigin(url)).toThrow(ConnectionRefusedError);
    }
    expect(
      (
        await f.request("/" + id + "/grants/alice-bot", "PUT", "alice", {
          permission: "admin",
        })
      ).status,
    ).toBe(400);
  });
  it("retains a distinct audit trail for grants without storing secrets", async () => {
    const f = fixture();
    const events: unknown[] = [];
    const audit = {
      insert: async (input: unknown) => {
        events.push(input);
      },
    };
    const user: MiddlewareHandler<{ Variables: AppVariables }> = async (
      c,
      next,
    ) => {
      c.set("actor", {
        id: "alice",
        email: "alice@example.test",
        role: "user",
      });
      await next();
    };
    const profiles = {
      get: async () => ({
        ownerUserId: "alice",
        systemOwned: false,
        deletedAt: null,
      }),
    };
    const app = createConexoesRoutes(f.store, user, profiles as never, audit);
    const result = await app.request("/" + id + "/grants/alice-bot", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission: "view" }),
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(events)).toContain("conexoes.permission_granted");
    expect(JSON.stringify(events)).not.toContain("password");
  });
});
