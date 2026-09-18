import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AppError } from "@maicora/shared";
import { bearerToken, verifyAccessToken } from "@maicora/auth";
import { buildContainer } from "@maicora/api/container";
import { buildMcpServer } from "./server.js";

const container = buildContainer();
const port = Number(process.env.MCP_PORT ?? 4100);

/**
 * Every request is authenticated on its own and handled by a fresh server
 * instance (the SDK's stateless mode). External MCP clients are not trusted
 * to hold a session: the token and the tenant they name are what decide which
 * tools they can see, and a client that switches tenants must switch headers.
 */
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await verifyAccessToken(bearerToken(req.headers.authorization), container.jwt);
  await container.auth.syncUser(user);

  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || !tenantId) {
    throw new AppError("VALIDATION_ERROR", "Send an X-Tenant-Id header naming the company to act in");
  }
  const actor = await container.auth.resolveActor(user, tenantId);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => void transport.close());

  await buildMcpServer(container, actor).connect(transport);
  await transport.handleRequest(req, res);
}

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  handle(req, res).catch((error: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = error instanceof AppError && error.code === "UNAUTHENTICATED" ? 401 : 400;
    const message = error instanceof Error ? error.message : "Bad request";
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: { message } }));
  });
});

http.listen(port, "0.0.0.0", () => {
  console.log(`Maicora MCP gateway listening on :${port}`);
});
