import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ActorContext } from "@maicora/shared";
import type { Container } from "@maicora/api/container";

/**
 * The MCP gateway is a transport, not a layer of logic. Every tool call goes
 * straight to the same CapabilityRegistry the web app and the agent use, with
 * `channel: "mcp"` so the narrower tool list of docs/mvp/10-mcp.md applies and
 * the audit trail records where the call came from (non-negotiable #9: no
 * business logic inside MCP handlers).
 */
export function buildMcpServer(container: Container, actor: ActorContext): Server {
  const server = new Server(
    { name: "maicora", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: container.capabilities.toolDefinitions(actor, { mcpOnly: true }).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await container.capabilities.invoke(actor, name, args ?? {}, { channel: "mcp" });

      const capability = container.capabilities.get(name);
      if (!capability.readOnly) {
        await container.audit.recordSafely(actor, actor.userId, {
          action: `capability.${name}`,
          metadata: { channel: "mcp" },
        });
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      // A refused permission is an answer the calling agent can act on, not a
      // dropped connection. MCP carries it as a failed tool result.
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  });

  return server;
}
