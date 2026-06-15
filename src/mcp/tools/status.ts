import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getIndexStats } from "@/db";

import type { McpContext, StatusResult } from "../types";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "Report dennoh index health: indexedCount (live notes in the index) and latestError. queueDepth is included only when a file watcher is attached to the server.";

export function registerStatus(server: McpServer, context: McpContext): void {
  // No input schema: `status` takes no parameters.
  server.registerTool("status", { description: DESCRIPTION }, async () => {
    try {
      const stats = getIndexStats(context.db);
      // queueDepth is omitted: the serve foundation does not attach a watcher,
      // and latestError stays null until an error-tracking subsystem feeds it.
      const result: StatusResult = { indexedCount: stats.noteCount, latestError: null };
      return toolOk(result);
    } catch (e) {
      return toolError(e);
    }
  });
}
