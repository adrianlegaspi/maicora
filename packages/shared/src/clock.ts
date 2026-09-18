/** Injectable clock so tests can control "now" instead of mocking global Date. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(date: Date): Clock {
  return { now: () => date };
}
