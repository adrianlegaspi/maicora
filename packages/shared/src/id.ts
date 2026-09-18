import { randomUUID } from "node:crypto";

/** Central place for ID generation so the strategy can change in one spot. */
export function newId(): string {
  return randomUUID();
}
