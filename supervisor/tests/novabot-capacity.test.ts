import { describe, expect, it } from "bun:test";
import {
  ComputerCapacityError,
  createComputerAdmissionGate,
  NotEnoughMemoryError,
} from "../src/novabot-capacity";

const gate = (
  limit: number,
  listComputers = async () =>
    [] as { kind: string; id: string; status: string }[],
  availableMb = () => 8192,
  estimatedStartupMb = 640,
) =>
  createComputerAdmissionGate({
    maxComputers: limit,
    minAvailableMb: 3072,
    estimatedStartupMb,
    listComputers,
    availableMb,
  });

describe("NovaBot computer capacity", () => {
  it("admits independent computers in parallel up to the configured cap", async () => {
    const admission = gate(2);
    const [releaseA, releaseB] = await Promise.all([
      admission.acquire("bot", "jojo"),
      admission.acquire("bot", "programador"),
    ]);
    await expect(admission.acquire("bot", "midia")).rejects.toBeInstanceOf(
      ComputerCapacityError,
    );
    releaseA();
    const releaseC = await admission.acquire("bot", "midia");
    releaseB();
    releaseC();
  });

  it("counts concurrent starts of the same computer once", async () => {
    const admission = gate(1);
    const releaseA = await admission.acquire("bot", "jojo");
    const releaseAgain = await admission.acquire("bot", "jojo");
    await expect(
      admission.acquire("bot", "programador"),
    ).rejects.toBeInstanceOf(ComputerCapacityError);
    releaseAgain();
    releaseA();
    const releaseB = await admission.acquire("bot", "programador");
    releaseB();
  });

  it("never evicts a running computer to accommodate a new one", async () => {
    const admission = gate(1, async () => [
      { kind: "bot", id: "jojo", status: "running" },
    ]);
    await expect(
      admission.acquire("bot", "programador"),
    ).rejects.toBeInstanceOf(ComputerCapacityError);
    const release = await admission.acquire("bot", "jojo");
    release();
  });

  it("refuses new starts under the memory reserve", async () => {
    const admission = gate(
      3,
      async () => [],
      () => 2048,
    );
    await expect(admission.acquire("bot", "jojo")).rejects.toBeInstanceOf(
      NotEnoughMemoryError,
    );
  });

  it("reserves RAM for concurrent computer startups", async () => {
    const admission = gate(
      3,
      async () => [],
      () => 4000,
    );
    const first = await admission.acquire("bot", "jojo");
    await expect(
      admission.acquire("bot", "programador"),
    ).rejects.toBeInstanceOf(NotEnoughMemoryError);
    first();
  });

  it("releases slots idempotently", async () => {
    const admission = gate(1);
    const release = await admission.acquire("bot", "jojo");
    release();
    release();
    const next = await admission.acquire("bot", "programador");
    next();
  });
});
