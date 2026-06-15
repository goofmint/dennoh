import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { searchMemory } from "@/core/memory";

import type { McpContext } from "../types";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "Full-text search across the memory vault (title, body, and English translation). Optional filters narrow by project, tag, updated-at date range, and source. Returns the matching notes with snippets, newest-relevance first.";

// Mirror SearchFilters from the db layer; `source` is constrained to the single
// NoteSource value rather than a free string.
const filtersSchema = z
  .object({
    project: z.string().optional(),
    tag: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    source: z.enum(["note"]).optional(),
  })
  .optional();

export function registerSearchMemory(server: McpServer, context: McpContext): void {
  server.registerTool(
    "search_memory",
    {
      description: DESCRIPTION,
      inputSchema: {
        query: z.string().min(1),
        filters: filtersSchema,
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ query, filters, limit }) => {
      try {
        const results = searchMemory(context.db, query, filters, limit);
        return toolOk({ results });
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
