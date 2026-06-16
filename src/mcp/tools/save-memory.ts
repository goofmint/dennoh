import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { saveMemory } from "@/core/memory";
import { getNoteById } from "@/db";

import type { McpContext } from "../types";
import { noteMetadata } from "./metadata";
import { toolError, toolOk } from "./result";

const DESCRIPTION =
  "Save a new note to the dennoh memory vault. `content` is markdown; #project and @tag mentions are extracted automatically into the note's metadata. Returns the created note's metadata (id, path, timestamps, projects, tags).";

export function registerSaveMemory(server: McpServer, context: McpContext): void {
  server.registerTool(
    "save_memory",
    {
      description: DESCRIPTION,
      inputSchema: {
        content: z.string().min(1),
        // The only NoteSource today is "note"; constrain the input to match
        // core/saveMemory rather than accepting an arbitrary string.
        source: z.enum(["note"]).optional(),
      },
    },
    async ({ content, source }) => {
      try {
        const id = await saveMemory(context.db, context.vaultPath, content, source);
        const row = getNoteById(context.db, id);
        if (row === null) {
          throw new Error(`saved note ${id} could not be read back`);
        }
        return toolOk(noteMetadata(row));
      } catch (e) {
        return toolError(e);
      }
    }
  );
}
