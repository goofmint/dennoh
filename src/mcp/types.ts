// Result shape for the future `status` MCP tool (T10.10): index health the
// client can render. For this foundation it carries the index counters; queue
// depth and last-error fields are added when those subsystems are wired.
export type StatusResult = {
  // Number of live (non-deleted) notes in the index.
  noteCount: number;
  // ISO 8601 timestamp of the most recently updated note, or null when empty.
  lastUpdatedAt: string | null;
};
