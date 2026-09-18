import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ActorContext } from "@maicora/shared";
import { CapabilityRegistry, type Capability } from "@maicora/capabilities";
import { PERMISSIONS, permissionsForRole } from "@maicora/tenancy";
import type { Container } from "@maicora/api/container";
import { buildMcpServer } from "./server.js";

function actor(role: "OWNER" | "VIEWER"): ActorContext {
  return {
    tenantId: "t1",
    userId: "u1",
    membershipId: "m1",
    roles: [role],
    permissions: permissionsForRole(role),
  };
}

const exposed: Capability<{ id: string }, { id: string }> = {
  name: "products.get",
  description: "read one product",
  permission: PERMISSIONS.PRODUCTS_READ,
  readOnly: true,
  mcp: true,
  input: z.object({ id: z.string().min(1) }),
  handler: async (_actor, input) => ({ id: input.id }),
};

const internalOnly: Capability<Record<string, never>, string> = {
  name: "invoices.prepare_cancellation",
  description: "draft a cancellation",
  permission: PERMISSIONS.INVOICES_WRITE,
  readOnly: false,
  mcp: false,
  input: z.object({}),
  handler: async () => "drafted",
};

/** Only the two fields the MCP server actually touches. */
function container(): Container {
  const capabilities = new CapabilityRegistry().registerAll([exposed, internalOnly] as never);
  return {
    capabilities,
    audit: { recordSafely: async () => undefined },
  } as unknown as Container;
}

async function connect(role: "OWNER" | "VIEWER"): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(container(), actor(role)).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP gateway", () => {
  it("advertises only the tools docs/mvp/10-mcp.md exposes", async () => {
    const { tools } = await (await connect("OWNER")).listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["products.get"]);
  });

  it("hides tools the actor has no permission for", async () => {
    const { tools } = await (await connect("VIEWER")).listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["products.get"]);
  });

  it("runs an exposed tool through the registry", async () => {
    const result = await (await connect("OWNER")).callTool({ name: "products.get", arguments: { id: "p1" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ id: "p1" });
  });

  it("refuses a capability that is not exposed over MCP, even for an owner", async () => {
    const result = await (await connect("OWNER")).callTool({
      name: "invoices.prepare_cancellation",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/not found/i);
  });

  it("returns a validation failure as a tool error rather than dropping the connection", async () => {
    const result = await (await connect("OWNER")).callTool({ name: "products.get", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toMatch(/invalid input/i);
  });
});
