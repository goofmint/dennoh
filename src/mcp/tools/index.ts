import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpContext } from "../types";
import { registerDeleteMemory } from "./delete-memory";
import { registerGetNote } from "./get-note";
import { registerListRecent } from "./list-recent";
import { registerSaveMemory } from "./save-memory";
import { registerSearchMemory } from "./search-memory";
import { registerStatus } from "./status";
import { registerUpdateMemory } from "./update-memory";

// Register every dennoh MCP tool on `server`. Called once from createMcpServer.
export function registerAllTools(server: McpServer, context: McpContext): void {
  registerSaveMemory(server, context);
  registerUpdateMemory(server, context);
  registerDeleteMemory(server, context);
  registerSearchMemory(server, context);
  registerListRecent(server, context);
  registerGetNote(server, context);
  registerStatus(server, context);
}
