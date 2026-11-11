import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { ActionActor } from "../src/computer/gateway";
import { decryptSecret } from "../src/credentials";
import {
  createSignInService,
  type SignInServiceDependencies,
} from "../src/passwords/service";
import { createMemoryPasswordStore } from "../src/passwords/store";
import { SignInRefusedError } from "../src/passwords/types";

const actor = (id: string) =>
  ({ id, userId: id, initiator: { kind: "person" } }) as ActionActor;

function setup(enabled = true) {
  const store = createMemoryPasswordStore();
  const key = randomBytes(32).toString("base64");
  const service = createSignInService({
    store,
    gateway: {} as SignInServiceDependencies["gateway"],
    encryptionKey: key,
    passwordManagerEnabled: async () => enabled,
  });
  return { service, store, key };
}

describe("manually saved password vault", () => {
  test("encrypts the password and returns only safe metadata", async () => {
    const { service, store, key } = setup();
    const saved = await service.saveManualLogin("alice", actor("alice"), {
      site: "https://instagram.com/login?from=home",
      username: " tiara ",
      password: "secret-not-for-the-agent",
    });

    expect(saved.origin).toBe("https://instagram.com");
    expect(saved.username).toBe("tiara");
    expect(JSON.stringify(saved)).not.toContain("secret-not-for-the-agent");

    const stored = await store.login("alice", saved.id);
    expect(stored).not.toBeNull();
    expect(stored?.encryptedPassword).not.toContain("secret-not-for-the-agent");
    expect(await decryptSecret(key, stored!.encryptedPassword)).toBe(
      "secret-not-for-the-agent",
    );

    const list = await service.logins("alice");
    expect(list.logins).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("encryptedPassword");
    expect(JSON.stringify(list)).not.toContain("secret-not-for-the-agent");
  });

  test("never exposes another owner's login", async () => {
    const { service, store } = setup();
    const saved = await service.saveManualLogin("alice", actor("alice"), {
      site: "https://example.com",
      username: "alice@example.com",
      password: "private-123",
    });
    expect(await store.login("bob", saved.id)).toBeNull();
    expect((await service.logins("bob")).logins).toHaveLength(0);
    await expect(service.deleteLogin("bob", saved.id, actor("bob"))).rejects.toBeInstanceOf(SignInRefusedError);
  });

  test("refuses the manual save when password management is disabled", async () => {
    const { service, store } = setup(false);
    await expect(
      service.saveManualLogin("alice", actor("alice"), {
        site: "https://example.com",
        username: "alice",
        password: "private-123",
      }),
    ).rejects.toBeInstanceOf(SignInRefusedError);
    expect(store.saved.size).toBe(0);
  });

  test("refuses HTTP and credential-in-URL sites", async () => {
    const { service, store } = setup();
    await expect(
      service.saveManualLogin("alice", actor("alice"), {
        site: "http://example.com",
        username: "alice",
        password: "private-123",
      }),
    ).rejects.toBeInstanceOf(SignInRefusedError);
    await expect(
      service.saveManualLogin("alice", actor("alice"), {
        site: "https://user:password@example.com",
        username: "alice",
        password: "private-123",
      }),
    ).rejects.toBeInstanceOf(SignInRefusedError);
    expect(store.saved.size).toBe(0);
  });
});
