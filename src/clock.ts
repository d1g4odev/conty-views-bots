export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date | string): Clock & { set(next: Date | string): void; advanceHours(hours: number): void } {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
    advanceHours: (hours) => {
      current = new Date(current.getTime() + hours * 3_600_000);
    },
  };
}
