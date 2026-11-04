/**
 * Admission gate for NovaBot computers.
 *
 * Never evict a running computer to make room for another request: it may be
 * performing a long operation. Reclaiming confirmed idle computers is the
 * responsibility of the separate idle reaper.
 *
 * Reservations prevent two simultaneous /ensure requests from both observing
 * an empty slot and starting more computers than the configured limit.
 */
export type RunningComputer = { kind: string; id: string; status: string };

export class ComputerCapacityError extends Error {
  constructor(limit: number) {
    super(
      `All ${limit} computer slots are occupied. Try again after a computer becomes idle, or increase NOVABOT_MAX_COMPUTERS when the host has capacity.`,
    );
    this.name = "ComputerCapacityError";
  }
}

export class NotEnoughMemoryError extends Error {
  constructor(available: number, floor: number) {
    super(
      `Not starting a computer: estimated RAM after computer reservations is ${available} MB, under the ${floor} MB safety floor.`,
    );
    this.name = "NotEnoughMemoryError";
  }
}

export function createComputerAdmissionGate(options: {
  maxComputers: number;
  minAvailableMb: number;
  /** Conservative RAM estimate for each computer that is starting. */
  estimatedStartupMb?: number;
  listComputers: () => Promise<RunningComputer[]>;
  availableMb: () => number;
  onActivity?: (kind: string, id: string) => void;
}): { acquire: (kind: string, id: string) => Promise<() => void> } {
  const pending = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  const isRunning = (status: string) => /^(running|up)/i.test(status);

  /** Serialize only capacity decisions; computer startup itself remains parallel. */
  async function locked<T>(task: () => Promise<T>): Promise<T> {
    const previous = queue;
    let unlock!: () => void;
    queue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      unlock();
    }
  }

  return {
    acquire(kind, id) {
      return locked(async () => {
        const key = `${kind}/${id}`;
        const running = (await options.listComputers()).filter((computer) =>
          isRunning(computer.status),
        );
        // A running computer needs no new slot. Nor does a second caller
        // trying to start the same computer while the first is still pending.
        if (
          running.some(
            (computer) => `${computer.kind}/${computer.id}` === key,
          ) ||
          pending.has(key)
        ) {
          options.onActivity?.(kind, id);
          return () => {};
        }
        if (running.length + pending.size >= options.maxComputers) {
          throw new ComputerCapacityError(options.maxComputers);
        }
        const available = options.availableMb();
        // Pending starts may not yet appear in /proc/meminfo. Reserve RAM
        // for them and for the computer we are about to start.
        const estimatedStartupMb = Math.max(0, options.estimatedStartupMb ?? 0);
        const remaining = available - (pending.size + 1) * estimatedStartupMb;
        if (remaining < options.minAvailableMb) {
          throw new NotEnoughMemoryError(remaining, options.minAvailableMb);
        }
        pending.add(key);
        options.onActivity?.(kind, id);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          pending.delete(key);
        };
      });
    },
  };
}
