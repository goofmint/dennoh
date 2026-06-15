import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listRecent } from "@/core/memory";

import type { McpContext } from "../types";
import { noteMetadata } from "./metadata";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "List the most recently updated notes (metadata only, newest first). `limit` bounds the count (default 10). Pair with get_note to read full bodies.";

export function registerListRecent(server: McpServer, context: McpContext): void {
  server.registerTool(
    "list_recent",
    {
      description: DESCRIPTION,
      inputSchema: {
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ limit }) => {
      try {
        const rows = listRecent(context.db, limit);
        return toolOk({ notes: rows.map(noteMetadata) });
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
