import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { updateMemory } from "@/core/memory";
import { getNoteById } from "@/db";

import type { McpContext } from "../types";
import { noteMetadata } from "./metadata";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "Update an existing note's content by id. #project and @tag mentions are re-extracted from the new content; createdAt is preserved and updatedAt is bumped. Returns the updated note's metadata.";

export function registerUpdateMemory(server: McpServer, context: McpContext): void {
  server.registerTool(
    "update_memory",
    {
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().min(1),
        content: z.string().min(1),
      },
    },
    async ({ id, content }) => {
      try {
        await updateMemory(context.db, context.vaultPath, id, content);
        const row = getNoteById(context.db, id);
        if (row === null) {
          throw new Error(`updated note ${id} could not be read back`);
        }
        return toolOk(noteMetadata(row));
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
