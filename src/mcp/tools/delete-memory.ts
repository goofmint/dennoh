import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { deleteMemory } from "@/core/memory";

import type { McpContext } from "../types";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "Delete a note by id: removes the markdown file, soft-deletes the index row, and records a git commit. Returns { id, deleted: true } on success, or an error result if the note does not exist.";

export function registerDeleteMemory(server: McpServer, context: McpContext): void {
  server.registerTool(
    "delete_memory",
    {
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      try {
        await deleteMemory(context.db, context.vaultPath, id);
        return toolOk({ id, deleted: true });
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
