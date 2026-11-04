import { describe, expect, it } from "bun:test";
import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { createSharedResourceRoutes } from "../src/novabot-resources/routes";
import {
  ResourceRefusedError,
  type SharedResourceStore,
} from "../src/novabot-resources/store";
import { sharedResourceTools } from "../src/novabot-resources/tools";

const sampleId = "a0000000-0000-4000-8000-000000000001";

function fixture() {
  const records = new Map<
    string,
    { owner: string; title: string; content: string }
  >();
  const grants = new Map<string, "read" | "write">();
  records.set(sampleId, {
    owner: "alice",
    title: "Campanha",
    content: "Texto privado",
  });
  const checked = (owner: string, id: string) => {
    const found = records.get(id);
    if (!found || found.owner !== owner)
      throw new ResourceRefusedError("Resource not found.");
    return found;
  };
  const store = {
    listOwned: async (owner: string) =>
      [...records.entries()]
        .filter(([, row]) => row.owner === owner)
        .map(([id, row]) => ({ id, ...row })),
    create: async (owner: string, title: string, content: string) => {
      const id = "a0000000-0000-4000-8000-000000000002";
      records.set(id, { owner, title, content });
      return { id, title, content };
    },
    readOwned: async (owner: string, id: string) => ({
      id,
      ...checked(owner, id),
    }),
    updateOwned: async (
      owner: string,
      id: string,
      title: string,
      content: string,
    ) => {
      checked(owner, id);
      records.set(id, { owner, title, content });
      return { id, title, content };
    },
    removeOwned: async (owner: string, id: string) => {
      checked(owner, id);
      records.delete(id);
    },
    grantsFor: async (owner: string, id: string) => {
      checked(owner, id);
      return [...grants.entries()].map(([botId, permission]) => ({
        botId,
        permission,
      }));
    },
    grant: async (
      owner: string,
      id: string,
      botId: string,
      permission: "read" | "write",
    ) => {
      checked(owner, id);
      grants.set(botId, permission);
      return { botId, permission };
    },
    revoke: async (owner: string, id: string, botId: string) => {
      checked(owner, id);
      grants.delete(botId);
    },
    listForBot: async (owner: string, bot: string) => {
      if (owner !== "alice" || !grants.has(bot)) return [];
      return [{ id: sampleId, title: "Campanha" }];
    },
    readForBot: async (owner: string, bot: string, id: string) => {
      const r = checked(owner, id);
      if (!grants.has(bot)) throw new ResourceRefusedError("Read not granted.");
      return { id, title: r.title, content: r.content };
    },
    writeForBot: async (
      owner: string,
      bot: string,
      id: string,
      content: string,
    ) => {
      const r = checked(owner, id);
      if (grants.get(bot) !== "write")
        throw new ResourceRefusedError("Write not granted.");
      r.content = content;
      return { id };
    },
  } as unknown as SharedResourceStore;
  const requireUser: MiddlewareHandler<{ Variables: AppVariables }> = async (
    ctx,
    next,
  ) => {
    const id = ctx.req.header("x-test-actor");
    if (!id) return ctx.json({ error: "Authentication required." }, 401);
    ctx.set("actor", { id, email: id + "@example.invalid", role: "user" });
    await next();
  };
  const app = createSharedResourceRoutes(
    store,
    requireUser,
    async (_actor, bot) => bot !== "outside",
  );
  const request = (
    path: string,
    method = "GET",
    owner = "alice",
    body?: object,
  ) =>
    app.request(path, {
      method,
      headers: {
        "x-test-actor": owner,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { store, request, grants };
}

describe("NovaBot private shared resources", () => {
  it("rejects unauthenticated requests", async () => {
    const f = fixture();
    const res = await f.request("/", "GET", "");
    expect(res.status).toBe(401);
  });
  it("does not expose another person's documents by id or listing", async () => {
    const f = fixture();
    expect((await f.request("/", "GET", "bob")).status).toBe(200);
    expect(
      (await (await f.request("/", "GET", "bob")).json()).resources,
    ).toEqual([]);
    expect((await f.request("/" + sampleId, "GET", "bob")).status).toBe(404);
    expect(
      (
        await f.request("/" + sampleId, "PUT", "bob", {
          title: "Outra",
          content: "",
        })
      ).status,
    ).toBe(404);
    expect((await f.request("/" + sampleId, "DELETE", "bob")).status).toBe(404);
  });
  it("refuses granting access to a Bot not accessible to this person", async () => {
    const f = fixture();
    expect(
      (
        await f.request("/" + sampleId + "/grants/outside", "PUT", "alice", {
          permission: "read",
        })
      ).status,
    ).toBe(403);
    expect(f.grants.size).toBe(0);
  });
  it("can grant and revoke Bot access explicitly", async () => {
    const f = fixture();
    expect(
      (
        await f.request("/" + sampleId + "/grants/jojo", "PUT", "alice", {
          permission: "read",
        })
      ).status,
    ).toBe(200);
    expect(f.grants.get("jojo")).toBe("read");
    expect(
      (await f.request("/" + sampleId + "/grants/jojo", "DELETE", "alice"))
        .status,
    ).toBe(200);
    expect(f.grants.has("jojo")).toBe(false);
  });
  it("refuses unauthorized Bot reads and writes, including after revocation", async () => {
    const f = fixture();
    const tools = sharedResourceTools(f.store, "alice", "jojo");
    const read = tools.find((t) => t.name === "shared_resource_read");
    const write = tools.find((t) => t.name === "shared_resource_write");
    expect(String(await read?.execute({ id: sampleId }))).toContain("Refused.");
    await f.store.grant("alice", sampleId, "jojo", "read");
    expect(String(await read?.execute({ id: sampleId }))).toContain("Texto privado");
    expect(String(await write?.execute({ id: sampleId, content: "Mudança" }))).toContain("Refused.");
    await f.store.grant("alice", sampleId, "jojo", "write");
    expect(String(await write?.execute({ id: sampleId, content: "Mudança" }))).toContain(sampleId);
    await f.store.revoke("alice", sampleId, "jojo");
    expect(String(await read?.execute({ id: sampleId }))).toContain("Refused.");
    expect(String(await write?.execute({ id: sampleId, content: "Outra" }))).toContain("Refused.");
  });
  it("a grant never gives a Bot access when acting for another person", async () => {
    const f = fixture();
    await f.store.grant("alice", sampleId, "jojo", "write");
    const other = sharedResourceTools(f.store, "bob", "jojo");
    const read = other.find((tool) => tool.name === "shared_resource_read");
    expect(String(await read?.execute({ id: sampleId }))).toContain("Refused.");
  });
});
