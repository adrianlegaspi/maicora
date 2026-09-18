import { zodToJsonSchema } from "zod-to-json-schema";
import { hasPermission, NotFoundError, ValidationError, type ActorContext } from "@maicora/shared";
import { assertPermission } from "@maicora/tenancy";
import type { Capability, ToolDefinition } from "./types.js";

export interface InvokeOptions {
  /** Surfaces in the audit trail and marks proposals as agent-requested. */
  channel?: "api" | "agent" | "mcp";
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability<never, unknown>>();

  register<I, O>(capability: Capability<I, O>): this {
    if (this.capabilities.has(capability.name)) {
      throw new Error(`Capability ${capability.name} is already registered`);
    }
    this.capabilities.set(capability.name, capability as unknown as Capability<never, unknown>);
    return this;
  }

  registerAll(capabilities: Capability<never, unknown>[]): this {
    for (const capability of capabilities) this.register(capability);
    return this;
  }

  get(name: string): Capability<never, unknown> {
    const capability = this.capabilities.get(name);
    if (!capability) throw new NotFoundError("Capability", name);
    return capability;
  }

  /**
   * The capabilities this actor may use. A VIEWER never sees a tool they
   * would only be refused, which keeps the model from proposing actions the
   * user cannot take (docs/mvp/09-proposals-and-governance.md).
   */
  listFor(actor: ActorContext, options: { mcpOnly?: boolean } = {}): Capability<never, unknown>[] {
    return [...this.capabilities.values()].filter(
      (capability) =>
        hasPermission(actor, capability.permission) && (!options.mcpOnly || capability.mcp),
    );
  }

  toolDefinitions(actor: ActorContext, options: { mcpOnly?: boolean } = {}): ToolDefinition[] {
    return this.listFor(actor, options).map((capability) => ({
      name: capability.name,
      description: capability.description,
      inputSchema: zodToJsonSchema(capability.input, { target: "openApi3" }) as Record<string, unknown>,
    }));
  }

  /**
   * The one execution path. Input is parsed before the handler sees it, and
   * the permission is asserted here as well as inside the domain service:
   * a tool call arriving over MCP is untrusted input, not an internal call.
   */
  async invoke(actor: ActorContext, name: string, rawInput: unknown, options: InvokeOptions = {}) {
    const capability = this.get(name);
    if (options.channel === "mcp" && !capability.mcp) {
      throw new NotFoundError("Capability", name);
    }
    assertPermission(actor, capability.permission);

    const parsed = capability.input.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(`Invalid input for ${name}`, {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return capability.handler(actor, parsed.data as never);
  }
}
