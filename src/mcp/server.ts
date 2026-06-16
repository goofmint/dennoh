import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import pkg from "../../package.json" with { type: "json" };

import { registerAllTools } from "./tools";
import type { McpContext } from "./types";

// MCP server identity advertised to clients during `initialize`. The name is a
// stable constant; the version tracks package.json so a single bump propagates.
export const SERVER_NAME = "dennoh";

// Build the MCP server instance and register all dennoh tools against the given
// context (the open index + vault root). Tool handlers bridge into the core
// layer; see src/mcp/tools.
export function createMcpServer(context: McpContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: pkg.version });
  registerAllTools(server, context);
  return server;
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
