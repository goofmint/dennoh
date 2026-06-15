import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getNote } from "@/core/memory";

import type { McpContext } from "../types";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "Fetch a single note by id, including its full body and frontmatter. Returns { note: { id, frontmatter, body } }, or { note: null } when the id is unknown or the note was deleted.";

export function registerGetNote(server: McpServer, context: McpContext): void {
  server.registerTool(
    "get_note",
    {
      description: DESCRIPTION,
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      try {
        const note = await getNote(context.db, context.vaultPath, id);
        return toolOk({ note });
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
