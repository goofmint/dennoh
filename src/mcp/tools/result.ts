import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Tools report outcomes inside the result object, never by throwing: a thrown
// error surfaces as an MCP *protocol* error, whereas `isError: true` is a
// tool-level result the model can read and recover from. Payloads are returned
// as pretty-printed JSON text so any client (structured or text-only) can use
// them.
export function toolOk(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function toolError(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: message }], isError: true };
}
