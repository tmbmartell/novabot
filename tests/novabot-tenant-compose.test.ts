import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ComposeStack = {
  name: string;
  services: Record<
    string,
    {
      image?: string;
      environment?: Record<string, string>;
      networks?: Record<string, unknown>;
      ports?: { published?: string; target?: number }[];
      volumes?: { source: string; target: string }[];
    }
  >;
};

function renderTenant(name: string, port: number): ComposeStack {
  const folder = mkdtempSync(join(tmpdir(), "novabot-tenant-test-"));
  try {
    const file = join(folder, "tenant.env");
    writeFileSync(file, "NOVABOT_LOCAL_RUNTIME=true\n");
    const text = execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-f",
        join(import.meta.dir, "..", "docker-compose.novabot.yml"),
        "config",
        "--format",
        "json",
      ],
      {
        cwd: join(import.meta.dir, ".."),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          NOVABOT_PROJECT_NAME: name,
          NOVABOT_HOST_PORT: String(port),
          NOVABOT_ENV_FILE: file,
          NOVABOT_DATA_DIR: join(folder, "data"),
          NOVABOT_MAX_COMPUTERS: "2",
          PG_PASSWORD: `pg-for-${name}`,
          OPENAI_API_KEY: `test-for-${name}`,
          SUPERVISOR_TOKEN: `supervisor-for-${name}`,
          COMPUTER_TOKEN: `computer-for-${name}`,
          WORKER_SHARED_SECRET: `worker-for-${name}`,
          MANAGED_AGENT_TOKEN: `agent-for-${name}`,
        },
      },
    );
    return JSON.parse(text) as ComposeStack;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe("NovaBot independent tenant stacks (configuration only)", () => {
  it("renders distinct projects, networks, volumes, ports, and supervisor namespaces", () => {
    const a = renderTenant("novabot-tenant-a", 13011);
    const b = renderTenant("novabot-tenant-b", 13012);

    expect(a.name).toBe("novabot-tenant-a");
    expect(b.name).toBe("novabot-tenant-b");

    const aNetworks = Object.keys(a.services.server?.networks ?? {});
    const bNetworks = Object.keys(b.services.server?.networks ?? {});
    expect(aNetworks).not.toEqual(bNetworks);
    expect(
      aNetworks.some((network) => network.startsWith("novabot-tenant-a_")),
    ).toBe(true);
    expect(
      bNetworks.some((network) => network.startsWith("novabot-tenant-b_")),
    ).toBe(true);

    expect(a.services.postgres?.volumes?.[0]?.source).not.toBe(
      b.services.postgres?.volumes?.[0]?.source,
    );
    expect(a.services.server?.volumes?.[0]?.source).not.toBe(
      b.services.server?.volumes?.[0]?.source,
    );
    expect(a.services.server?.ports?.[0]?.published).toBe("13011");
    expect(b.services.server?.ports?.[0]?.published).toBe("13012");
    expect(a.services.supervisor?.environment?.COMPUTER_NAMESPACE).toBe(
      "novabot-tenant-a",
    );
    expect(b.services.supervisor?.environment?.COMPUTER_NAMESPACE).toBe(
      "novabot-tenant-b",
    );
    expect(a.services.supervisor?.environment?.NOVABOT_MAX_COMPUTERS).toBe("2");
    expect(b.services.supervisor?.environment?.NOVABOT_MAX_COMPUTERS).toBe("2");
    expect(a.services.server?.image).toBe("novabot-tenant-a-server:latest");
    expect(b.services.server?.image).toBe("novabot-tenant-b-server:latest");
    expect(a.services.supervisor?.environment?.COMPUTER_NETWORK).not.toBe(
      b.services.supervisor?.environment?.COMPUTER_NETWORK,
    );
  });

  it("keeps credential values distinct across two tenant renders", () => {
    const a = renderTenant("novabot-tenant-a", 13011);
    const b = renderTenant("novabot-tenant-b", 13012);
    expect(a.services.server?.environment?.DATABASE_URL).not.toBe(
      b.services.server?.environment?.DATABASE_URL,
    );
    expect(a.services.supervisor?.environment?.SUPERVISOR_TOKEN).not.toBe(
      b.services.supervisor?.environment?.SUPERVISOR_TOKEN,
    );
  });
});
