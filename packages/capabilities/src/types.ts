import type { ZodType } from "zod";
import type { ActorContext } from "@maicora/shared";
import type { Permission } from "@maicora/tenancy";

/**
 * A capability is the single definition of one thing Maicora can do
 * (docs/mvp/08-agent.md). The agent, MCP and the REST API all invoke the same
 * object, so a permission cannot be enforced in one path and forgotten in
 * another, and a tool description cannot drift from what the code does.
 */
export interface Capability<Input = unknown, Output = unknown> {
  /** Dotted name exactly as the spec lists it, e.g. "inventory.get_stock". */
  name: string;
  /** Written for the model: what it does and when to reach for it. */
  description: string;
  permission: Permission;
  input: ZodType<Input>;
  /** True when the capability only reads. Everything else drafts a proposal. */
  readOnly: boolean;
  /**
   * Exposed to external MCP clients. docs/mvp/10-mcp.md lists a narrower set
   * than the agent gets, so this is opt-in per capability rather than derived.
   */
  mcp: boolean;
  handler: (actor: ActorContext, input: Input) => Promise<Output>;
}

/** A tool definition in the shape OpenAI-compatible APIs and MCP both consume. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
