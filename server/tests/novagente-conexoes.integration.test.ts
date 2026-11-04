import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  createConexoesStore,
  ConnectionRefusedError,
} from "../src/conexoes/store";
import { createDatabase } from "../src/db/client";
import { agents, novagenteApplications, users } from "../src/db/schema";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

/**
 * Actual PostgreSQL authorization test. An in-memory mock cannot prove the
 * ownership WHERE predicates or SQL grant/revoke operate atomically.
 *
 * Runs ONLY with an explicit TEST_DATABASE_URL and the migrations applied
 * to a disposable test database; never use the production DATABASE_URL.
 */
const db = createDatabase(testDatabaseUrl(), TEST_POOL);
const store = createConexoesStore(db);
const suffix = randomUUID().slice(0, 8);
const alice = `conexoes-alice-${suffix}`;
const bob = `conexoes-bob-${suffix}`;
const bot = `conexoes-bot-${suffix}`;
let appId = "";

beforeAll(async () => {
  for (const id of [alice, bob]) {
    await db.insert(users).values({
      id,
      email: `${id}@example.test`,
      name: id,
      emailVerified: true,
    });
  }
  await db.insert(agents).values({
    id: bot,
    name: "Bot teste Conexões",
    type: "built_in",
    configuration: {},
  });
});

afterAll(async () => {
  if (appId) {
    await db
      .delete(novagenteApplications)
      .where(inArray(novagenteApplications.id, [appId]));
  }
  await db.delete(agents).where(inArray(agents.id, [bot]));
  await db.delete(users).where(inArray(users.id, [alice, bob]));
});

describe("NOVAGENTE Conexões: SQL real e isolamento", () => {
  test("propriedade, permissões e revogação são conferidas no banco", async () => {
    const app = await store.create(
      alice,
      "CRM de homologação",
      "https://crm.example.com",
    );
    appId = app.id;
    expect(app.sessionStatus).toBe("not_connected");
    expect(await store.list(bob)).toHaveLength(0);
    expect(await store.allowed(alice, appId, bot, "view")).toBe(false);
    await expect(
      store.grant(bob, appId, bot, "operate"),
    ).rejects.toBeInstanceOf(ConnectionRefusedError);
    await expect(store.remove(bob, appId)).rejects.toBeInstanceOf(
      ConnectionRefusedError,
    );

    await store.grant(alice, appId, bot, "view");
    expect(await store.allowed(alice, appId, bot, "view")).toBe(true);
    expect(await store.allowed(alice, appId, bot, "operate")).toBe(false);
    expect(await store.allowed(bob, appId, bot, "view")).toBe(false);
    expect(await store.listGrants(bob, appId)).toEqual([]);

    await store.grant(alice, appId, bot, "operate");
    expect(await store.allowed(alice, appId, bot, "operate")).toBe(true);
    expect((await store.revoke(bob, appId, bot)).revoked).toBe(false);
    expect(await store.allowed(alice, appId, bot, "view")).toBe(true);
    expect((await store.revoke(alice, appId, bot)).revoked).toBe(true);
    expect(await store.allowed(alice, appId, bot, "view")).toBe(false);
  });

  test("registro único por dono, sem vazar dados de outros usuários", async () => {
    expect(appId).not.toBe("");
    await expect(
      store.create(alice, "Duplicada", "https://crm.example.com"),
    ).rejects.toThrow();
    // O mesmo site pode ser registrado por outra pessoa, sem compartilhar o registro.
    const b = await store.create(bob, "CRM privado", "https://crm.example.com");
    expect((await store.list(bob)).map((x) => x.id)).toContain(b.id);
    expect((await store.list(alice)).map((x) => x.id)).not.toContain(b.id);
    await store.remove(bob, b.id);
  });
});
