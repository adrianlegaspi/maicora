import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idempotencyKey } from "@maicora/capabilities";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

const prepareSchema = z.object({
  kind: z.enum(["CUSTOMERS", "PRODUCTS", "OPENING_STOCK"]),
  csv: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
});

/** Screen 21 (Bulk import). File upload, so REST-only - never an agent tool. */
export function importRoutes(app: FastifyInstance, container: Container): void {
  app.post("/imports/prepare", async (request, reply) => {
    const actor = requireActor(request);
    const input = prepareSchema.parse(request.body);
    const proposal = await container.imports.prepare(actor, {
      ...input,
      idempotencyKey: idempotencyKey("imports.prepare", input),
    });
    return reply.status(201).send(proposal);
  });
}
