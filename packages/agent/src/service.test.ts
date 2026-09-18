import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getTestDb, isTestDbReachable, seedTenant, truncateAll } from "@maicora/database/testing";
import { CapabilityRegistry, type Capability } from "@maicora/capabilities";
import { PERMISSIONS, permissionsForRole } from "@maicora/tenancy";
import type { ActorContext } from "@maicora/shared";
import { AgentService } from "./service.js";
import { FakeProvider } from "./fake.js";
import type { AgentEvent } from "./types.js";

const dbReachable = await isTestDbReachable();

const searchCapability: Capability<{ query: string }, { name: string }[]> = {
  name: "customers.search",
  description: "find customers",
  permission: PERMISSIONS.CUSTOMERS_READ,
  readOnly: true,
  mcp: true,
  input: z.object({ query: z.string() }),
  handler: async (_actor, input) => [{ name: `${input.query} SA de CV` }],
};

const draftCapability: Capability<{ productId: string }, never> = {
  name: "pricing.prepare_price_update",
  description: "draft a price change",
  permission: PERMISSIONS.PRICING_WRITE,
  readOnly: false,
  mcp: false,
  input: z.object({ productId: z.string() }),
  handler: async () => {
    throw new Error("Product not found");
  },
};

function registry() {
  return new CapabilityRegistry().registerAll([searchCapability, draftCapability] as never);
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe.skipIf(!dbReachable)("AgentService (integration)", () => {
  const db = getTestDb();
  let actor: ActorContext;
  let viewer: ActorContext;

  beforeEach(async () => {
    await truncateAll(db);
    const tenant = await seedTenant(db);
    actor = { ...tenant, roles: ["OWNER"], permissions: permissionsForRole("OWNER") };
    viewer = { ...actor, roles: ["VIEWER"], permissions: permissionsForRole("VIEWER") };
  });

  it("runs the tool the model asks for and feeds the result back", async () => {
    const provider = new FakeProvider([
      { toolCalls: [{ name: "customers.search", arguments: { query: "ACME" } }] },
      { text: "ACME SA de CV is your only match." },
    ]);
    const agent = new AgentService(db, registry(), provider);

    const events = await collect(agent.send(actor, { message: "find ACME" }));

    expect(events.map((event) => event.type)).toEqual([
      "tool_start",
      "tool_result",
      "text",
      "done",
    ]);
    expect(events[1]).toMatchObject({ ok: true, output: [{ name: "ACME SA de CV" }] });
  });

  it("persists the whole exchange, tool call included", async () => {
    const provider = new FakeProvider([
      { toolCalls: [{ name: "customers.search", arguments: { query: "ACME" } }] },
      { text: "Found it." },
    ]);
    const agent = new AgentService(db, registry(), provider);

    const events = await collect(agent.send(actor, { message: "find ACME" }));
    const done = events.at(-1) as Extract<AgentEvent, { type: "done" }>;
    const messages = await agent.getMessages(actor, done.conversationId);

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(messages[1]?.toolCalls).toHaveLength(1);
  });

  it("hands a refused capability back to the model instead of failing the turn", async () => {
    const provider = new FakeProvider([
      { toolCalls: [{ name: "pricing.prepare_price_update", arguments: { productId: "p1" } }] },
      { text: "You do not have permission to change prices." },
    ]);
    const agent = new AgentService(db, registry(), provider);

    const events = await collect(agent.send(viewer, { message: "raise the price" }));

    expect(events[1]).toMatchObject({ type: "tool_error", ok: false });
    expect(events.at(-2)).toMatchObject({ type: "text" });
  });

  it("only advertises the tools the actor may use", async () => {
    const provider = new FakeProvider([{ text: "hello" }]);
    const agent = new AgentService(db, registry(), provider);
    await collect(agent.send(viewer, { message: "hi" }));

    expect(registry().toolDefinitions(viewer).map((tool) => tool.name)).toEqual(["customers.search"]);
  });

  it("stops after maxSteps even if the model keeps calling tools", async () => {
    const turns = Array.from({ length: 5 }, () => ({
      toolCalls: [{ name: "customers.search", arguments: { query: "ACME" } }],
    }));
    const provider = new FakeProvider(turns);
    const agent = new AgentService(db, registry(), provider, { maxSteps: 2 });

    const events = await collect(agent.send(actor, { message: "loop" }));

    expect(events.filter((event) => event.type === "tool_start")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("refuses to continue another user's conversation", async () => {
    const provider = new FakeProvider([{ text: "hi" }]);
    const agent = new AgentService(db, registry(), provider);
    const events = await collect(agent.send(actor, { message: "hi" }));
    const done = events.at(-1) as Extract<AgentEvent, { type: "done" }>;

    const other = await seedTenant(db);
    const otherActor: ActorContext = {
      ...other,
      roles: ["OWNER"],
      permissions: permissionsForRole("OWNER"),
    };

    await expect(
      collect(
        new AgentService(db, registry(), new FakeProvider([{ text: "hi" }])).send(otherActor, {
          conversationId: done.conversationId,
          message: "what did they say?",
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
