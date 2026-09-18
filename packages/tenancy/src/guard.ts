import { ForbiddenError, hasPermission, type ActorContext } from "@maicora/shared";
import type { Permission } from "./permissions.js";

/** Throws ForbiddenError if the actor lacks the permission. Used at every capability/route boundary. */
export function assertPermission(actor: ActorContext, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}
