import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../container.js";
import { requireActor } from "../http.js";

const sendSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1),
});

/** Screen 3 (Agent workspace). */
export function agentRoutes(app: FastifyInstance, container: Container): void {
  app.get("/agent/conversations", async (request) =>
    container.agent.listConversations(requireActor(request)),
  );

  app.get("/agent/conversations/:id", async (request) => {
    const { id } = request.params as { id: string };
    return container.agent.getMessages(requireActor(request), id);
  });

  /**
   * Server-sent events, because the response is a stream of text deltas and
   * tool activity the composer renders as it arrives. The client aborting is
   * normal, so the provider call is cancelled rather than left running.
   */
  app.post("/agent/messages", async (request, reply) => {
    const actor = requireActor(request);
    const input = sendSchema.parse(request.body);

    const abort = new AbortController();
    request.raw.on("close", () => abort.abort());

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    try {
      for await (const event of container.agent.send(actor, input, abort.signal)) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      // The headers are already out, so the failure has to travel as an event.
      const message = error instanceof Error ? error.message : String(error);
      reply.raw.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    }

    reply.raw.end();
    return reply;
  });
}
