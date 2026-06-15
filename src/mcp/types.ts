import type { Database } from "bun:sqlite";

// Shared context every tool handler needs to bridge into the core layer: the
// open SQLite index and the vault root. Constructed once by `dennoh serve`.
export type McpContext = {
  db: Database;
  vaultPath: string;
};

// Result shape for the `status` MCP tool (T10.10). `queueDepth` is present only
// when a watcher is wired into the server (none yet in the serve foundation);
// `latestError` is null until an error-tracking subsystem feeds it.
export type StatusResult = {
  indexedCount: number;
  queueDepth?: number;
  latestError: string | null;
};
