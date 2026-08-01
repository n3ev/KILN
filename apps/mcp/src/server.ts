import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildRegistry, createSandboxEgressClient, type ToolContext } from "@kiln/tools";
import type { McpPrincipal } from "./tokens.js";

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function toolContext(principal: McpPrincipal, toolId: string): ToolContext {
  const runId = stableUuid(`mcp:${principal.accountId}`);
  return {
    runId,
    ventureId: stableUuid(`mcp-venture:${principal.accountId}`),
    accountId: principal.accountId,
    agentId: "mcp-client",
    seed: `mcp:${principal.accountId}:${toolId}`,
    sandbox: true,
    grantedScopes: principal.scopes.filter(isScope),
    lease: async () => {
      throw new Error("MCP prompt-1 access is sandboxed and cannot lease credentials");
    },
    http: createSandboxEgressClient(),
    logger: {
      debug(message, fields) { console.debug(message, fields ?? {}); },
      info(message, fields) { console.info(message, fields ?? {}); },
      warn(message, fields) { console.warn(message, fields ?? {}); },
    },
  };
}

const SCOPE_VALUES = new Set([
  "research:read", "identity:read", "identity:register", "design:generate",
  "commerce:read", "commerce:write", "commerce:publish", "commerce:transfer",
  "payments:read", "payments:write", "payments:refund", "supply:read", "supply:order",
  "site:build", "site:deploy", "dns:write", "content:write", "comms:configure",
  "comms:send", "booking:configure", "analytics:read", "analytics:write",
  "compliance:screen", "spend:external", "run:artifacts", "run:checkpoints", "run:notify",
]);

function isScope(value: string): value is ToolContext["grantedScopes"][number] {
  return SCOPE_VALUES.has(value);
}

export function createMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer(
    { name: "kiln-tools", version: "0.1.0" },
    {
      instructions:
        "KILN prompt-1 MCP access is read-only and always simulated. Results never touch a live customer account.",
    },
  );
  const tools = buildRegistry()
    .readOnly()
    .filter((tool) => tool.scopes.every((scope) => principal.scopes.includes(scope)));

  for (const tool of tools) {
    server.registerTool(
      tool.id,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (input) => {
        const parsed = tool.input.safeParse(input);
        if (!parsed.success) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }],
          };
        }
        try {
          // TODO(prompt-2): MCP write access. This server is deliberately
          // simulate-only — there is no `execute` path — until leases and
          // egress exist for a remote principal.
          const output = await tool.simulate(parsed.data as never, toolContext(principal, tool.id));
          const validated = tool.output.parse(output);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(validated, null, 2) }],
            structuredContent:
              validated !== null && typeof validated === "object"
                ? (validated as Record<string, unknown>)
                : { value: validated },
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          };
        }
      },
    );
  }
  return server;
}

export function createTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
}
