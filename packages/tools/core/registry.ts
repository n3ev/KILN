import type { Scope } from "@kiln/contracts";
import { InvariantViolated } from "@kiln/contracts";
import type { z } from "zod";
import { isReadOnly, type AnyTool, type SideEffect } from "./define.js";

/**
 * The tool registry.
 *
 * One authoritative catalogue, so the runtime, the MCP server, and the agent
 * allowlist checker all reason about the same set. Registration is explicit
 * rather than filesystem-scanned: a tool that reaches production because a file
 * happened to be in a directory is a tool nobody reviewed.
 */

export class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>();

  register(tool: AnyTool): this {
    const existing = this.tools.get(tool.id);
    if (existing && existing.version !== tool.version) {
      throw new InvariantViolated(
        `tool "${tool.id}" registered twice with different versions (${existing.version} vs ${tool.version})`,
      );
    }
    this.tools.set(tool.id, tool);
    return this;
  }

  registerAll(tools: readonly AnyTool[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  get(id: string): AnyTool | undefined {
    return this.tools.get(id);
  }

  require(id: string): AnyTool {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new InvariantViolated(`unknown tool "${id}"`, { known: this.ids().slice(0, 20) });
    }
    return tool;
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  ids(): string[] {
    return [...this.tools.keys()].sort();
  }

  all(): AnyTool[] {
    return [...this.tools.values()];
  }

  /** Everything under a namespace prefix, e.g. "shopify" or "shopify.product". */
  namespace(prefix: string): AnyTool[] {
    return this.all().filter((t) => t.id === prefix || t.id.startsWith(`${prefix}.`));
  }

  bySideEffect(effect: SideEffect): AnyTool[] {
    return this.all().filter((t) => t.sideEffect === effect);
  }

  /** The set exposed over MCP in prompt 1: sandbox, read-only. */
  readOnly(): AnyTool[] {
    return this.all().filter((t) => isReadOnly(t.sideEffect));
  }

  /** Union of scopes a set of tools needs. Used to compute a run's GrantSet. */
  scopesFor(ids: readonly string[]): Scope[] {
    const scopes = new Set<Scope>();
    for (const id of ids) {
      for (const s of this.require(id).scopes) scopes.add(s);
    }
    return [...scopes].sort();
  }

  /**
   * JSON Schema for the model's tool-calling API.
   *
   * Zod is the source of truth, so this derives from it rather than being
   * maintained alongside it — the failure mode of a hand-written duplicate is
   * an agent confidently sending arguments the tool will reject.
   */
  toModelSchemas(ids: readonly string[]): { name: string; description: string; parameters: Record<string, unknown> }[] {
    return ids.map((id) => {
      const tool = this.require(id);
      return {
        name: tool.id,
        description: tool.description,
        parameters: toJsonSchema(tool.input),
      };
    });
  }
}

/**
 * Minimal Zod → JSON Schema conversion covering the shapes tool inputs use.
 *
 * Deliberately not a general converter: tool inputs are flat-ish records by
 * design, and an unsupported node degrades to a permissive `{}` rather than
 * emitting a schema that lies about what is accepted. The tool's own Zod
 * validation is the real gate — this only has to be good enough to steer.
 */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = def["typeName"] as string;

  switch (typeName) {
    case "ZodString": {
      const checks = (def["checks"] as { kind: string; value?: unknown }[]) ?? [];
      const out: Record<string, unknown> = { type: "string" };
      for (const c of checks) {
        if (c.kind === "min") out["minLength"] = c.value;
        if (c.kind === "max") out["maxLength"] = c.value;
        if (["email", "url", "uuid"].includes(c.kind)) out["format"] = c.kind;
        if (c.kind === "datetime") out["format"] = "date-time";
      }
      return out;
    }
    case "ZodNumber": {
      const checks = (def["checks"] as { kind: string; value?: number }[]) ?? [];
      const isInt = checks.some((c) => c.kind === "int");
      const out: Record<string, unknown> = { type: isInt ? "integer" : "number" };
      for (const c of checks) {
        if (c.kind === "min") out["minimum"] = c.value;
        if (c.kind === "max") out["maximum"] = c.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: def["value"] };
    case "ZodEnum":
      return { type: "string", enum: def["values"] };
    case "ZodArray":
      return { type: "array", items: toJsonSchema(def["type"] as z.ZodTypeAny) };
    case "ZodObject": {
      const shape = (def["shape"] as () => Record<string, z.ZodTypeAny>)();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return { type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false };
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
      return toJsonSchema(def["innerType"] as z.ZodTypeAny);
    case "ZodBranded":
      return toJsonSchema(def["type"] as z.ZodTypeAny);
    case "ZodReadonly":
      return toJsonSchema(def["innerType"] as z.ZodTypeAny);
    case "ZodEffects":
      return toJsonSchema(def["schema"] as z.ZodTypeAny);
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return { anyOf: (def["options"] as z.ZodTypeAny[]).map(toJsonSchema) };
    case "ZodRecord":
      return { type: "object", additionalProperties: toJsonSchema(def["valueType"] as z.ZodTypeAny) };
    default:
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema as unknown as { _def: { typeName: string } })._def.typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

/** The process-wide registry. Populated by the catalogue's `registerCatalogue`. */
export const registry = new ToolRegistry();
