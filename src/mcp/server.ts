import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import pkg from "../../package.json" with { type: "json" };

// MCP server identity advertised to clients during `initialize`. The name is a
// stable constant; the version tracks package.json so a single bump propagates.
export const SERVER_NAME = "dennoh";

// Build the MCP server instance. Tool registration happens in later phases
// (T10.4+); this foundation only establishes identity and transport wiring.
export function createMcpServer(): McpServer {
  return new McpServer({ name: SERVER_NAME, version: pkg.version });
}

// Connect `server` to a transport (stdio by default) and resolve only once the
// connection closes — a client disconnect or stdin EOF. Resolving on close (not
// on connect) lets `dennoh serve` keep the process alive for the server's
// lifetime and run cleanup afterwards. The transport is injectable so tests can
// drive the lifecycle with an in-memory pair instead of real stdio.
export async function startStdioServer(
  server: McpServer,
  transport: Transport = new StdioServerTransport()
): Promise<void> {
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
}
