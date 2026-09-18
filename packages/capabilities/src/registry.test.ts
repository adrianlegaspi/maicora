import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PERMISSIONS, permissionsForRole } from "@maicora/tenancy";
import type { ActorContext } from "@maicora/shared";
import { CapabilityRegistry } from "./registry.js";
import type { Capability } from "./types.js";

function actorWithRole(role: "OWNER" | "VIEWER"): ActorContext {
  return {
    tenantId: "t1",
    userId: "u1",
    membershipId: "m1",
    roles: [role],
    permissions: permissionsForRole(role),
  };
}

const readCapability: Capability<{ id: string }, string> = {
  name: "products.get",
  description: "read one product",
  permission: PERMISSIONS.PRODUCTS_READ,
  readOnly: true,
  mcp: true,
  input: z.object({ id: z.string().uuid() }),
  handler: async (_actor, input) => input.id,
};

const writeCapability: Capability<{ id: string }, string> = {
  name: "pricing.prepare_price_update",
  description: "draft a price change",
  permission: PERMISSIONS.PRICING_WRITE,
  readOnly: false,
  mcp: false,
  input: z.object({ id: z.string().uuid() }),
  handler: async (_actor, input) => input.id,
};

function registry() {
  return new CapabilityRegistry().registerAll([readCapability, writeCapability] as never);
}

const UUID = "00000000-0000-4000-8000-000000000001";

describe("CapabilityRegistry", () => {
  it("hides capabilities the actor has no permission for", () => {
    const names = registry()
      .listFor(actorWithRole("VIEWER"))
      .map((capability) => capability.name);
    expect(names).toEqual(["products.get"]);
  });

  it("refuses a capability the actor may not use", async () => {
    await expect(
      registry().invoke(actorWithRole("VIEWER"), "pricing.prepare_price_update", { id: UUID }),
    ).rejects.toThrow(/permission/i);
  });

  it("hides non-MCP capabilities from the MCP channel", async () => {
    const owner = actorWithRole("OWNER");
    expect(registry().listFor(owner, { mcpOnly: true }).map((c) => c.name)).toEqual(["products.get"]);
    await expect(
      registry().invoke(owner, "pricing.prepare_price_update", { id: UUID }, { channel: "mcp" }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects input the schema does not accept before the handler runs", async () => {
    await expect(
      registry().invoke(actorWithRole("OWNER"), "products.get", { id: "not-a-uuid" }),
    ).rejects.toThrow(/Invalid input for products.get/);
  });

  it("advertises tools as JSON Schema", () => {
    const [tool] = registry().toolDefinitions(actorWithRole("OWNER"), { mcpOnly: true });
    expect(tool).toMatchObject({ name: "products.get", inputSchema: { type: "object" } });
  });

  it("refuses to register the same name twice", () => {
    expect(() => registry().register(readCapability)).toThrow(/already registered/);
  });
});
