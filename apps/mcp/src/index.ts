import { createServer } from "node:http";
import { config } from "@kiln/config";
import { closeDb } from "@kiln/db";
import { authenticateMcpToken } from "./tokens.js";
import { createMcpServer, createTransport } from "./server.js";

const port = config().MCP_PORT;

const httpServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, sandbox: true, writeTools: false }));
    return;
  }
  if (request.url !== "/mcp") {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST", "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Prompt-1 MCP is stateless; POST /mcp only." }));
    return;
  }

  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const principal = token ? await authenticateMcpToken(token) : undefined;
  if (!principal) {
    response.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
    response.end(JSON.stringify({ error: "Invalid, expired, revoked, or rate-limited MCP token." }));
    return;
  }

  const server = createMcpServer(principal);
  const transport = createTransport();
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await transport.close();
    await server.close();
  };
  response.once("close", () => void cleanup());
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  } finally {
    if (response.writableEnded) await cleanup();
  }
});

httpServer.listen(port, "127.0.0.1", () => {
  console.info(`KILN MCP listening on http://127.0.0.1:${port}/mcp (sandbox, read-only)`);
});

async function shutdown(): Promise<void> {
  httpServer.close();
  await closeDb();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

export { issueMcpToken, revokeMcpToken } from "./tokens.js";
