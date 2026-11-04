import { readFileSync } from "node:fs";
import { listOwned, stop } from "./docker";
import { namesFor } from "./names";

/**
 * NovaBot guard rails for a small shared VPS.
 *
 *  - NOVABOT_MAX_COMPUTERS (default 1): at most this many computers run at once. Asking for one more
 *    stops the least recently used computer first (its profile volume is kept, so nothing is lost).
 *  - NOVABOT_MIN_AVAILABLE_MB (default 3072): a computer is only started while the host has at least
 *    this much MemAvailable. Otherwise /ensure answers 503 and the Bot is told the computer is off.
 *  - NOVABOT_COMPUTER_IDLE_MINUTES (default 15): a computer no `/ensure` touched for this long is
 *    stopped. Every Bot action calls `/ensure`, so this is "no action for N minutes".
 */
const maxComputers = Math.max(
  1,
  Number(process.env.NOVABOT_MAX_COMPUTERS ?? 1) || 1,
);
const minAvailableMb =
  Number(process.env.NOVABOT_MIN_AVAILABLE_MB ?? 3072) || 3072;
const idleMs =
  (Number(process.env.NOVABOT_COMPUTER_IDLE_MINUTES ?? 15) || 15) * 60_000;

const lastUsed = new Map<string, number>(); // "kind/id" -> epoch ms

export class NotEnoughMemoryError extends Error {}

export function availableMb(meminfo = "/proc/meminfo"): number {
  try {
    const line = readFileSync(meminfo, "utf8").match(
      /^MemAvailable:\s+(\d+) kB/m,
    );
    return line ? Math.floor(Number(line[1]) / 1024) : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const isRunning = (status: string) => /^(running|up)/i.test(status);

/** Called before `ensure`: memory gate and the running-computer cap. */
export async function beforeEnsure(kind: string, id: string): Promise<void> {
  const key = `${kind}/${id}`;
  lastUsed.set(key, Date.now());
  const running = (await listOwned()).filter((c) => isRunning(c.status));
  if (running.some((c) => `${c.kind}/${c.id}` === key)) return; // already up: just activity
  const mb = availableMb();
  if (mb < minAvailableMb) {
    throw new NotEnoughMemoryError(
      `Not starting a computer: the host has ${mb} MB available, under the ${minAvailableMb} MB floor.`,
    );
  }
  const excess = running.length - maxComputers + 1;
  if (excess <= 0) return;
  const oldestFirst = running.sort(
    (a, b) =>
      (lastUsed.get(`${a.kind}/${a.id}`) ?? 0) -
      (lastUsed.get(`${b.kind}/${b.id}`) ?? 0),
  );
  for (const victim of oldestFirst.slice(0, excess)) {
    const parsed = namesFor(victim.kind, victim.id);
    if (parsed.ok) {
      console.log(
        JSON.stringify({
          type: "novabot-computer-evicted",
          kind: victim.kind,
          id: victim.id,
        }),
      );
      await stop(parsed.names);
    }
  }
}

/** Stops computers nobody used for `idleMs`. */
export function startIdleReaper(): void {
  const tick = async () => {
    try {
      for (const c of await listOwned()) {
        if (!isRunning(c.status)) continue;
        const key = `${c.kind}/${c.id}`;
        const seen = lastUsed.get(key);
        if (seen === undefined) {
          lastUsed.set(key, Date.now()); // running before we started: give it a full idle window
          continue;
        }
        if (Date.now() - seen < idleMs) continue;
        const parsed = namesFor(c.kind, c.id);
        if (!parsed.ok) continue;
        console.log(
          JSON.stringify({
            type: "novabot-computer-idle-stop",
            kind: c.kind,
            id: c.id,
          }),
        );
        await stop(parsed.names);
        lastUsed.delete(key);
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          type: "novabot-idle-reaper-failed",
          error: String(error),
        }),
      );
    }
  };
  setInterval(tick, 60_000).unref?.();
}
