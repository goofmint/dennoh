import type { Database } from "bun:sqlite";

import { type CliIO, readError } from "@/cli/types";
import { readConfig } from "@/config";
import { closeDatabase, openDatabase, runMigrations } from "@/db";
import { log } from "@/log";
import { createMcpServer, startStdioServer } from "@/mcp";

// `dennoh serve` — run the MCP server over stdio. stdout is reserved for the
// JSON-RPC protocol stream, so this handler emits diagnostics only via io.stderr
// and the log module (stderr-only). It blocks until the client disconnects.
export async function serveCommand(args: string[], io: CliIO): Promise<number> {
  if (args.length > 0) {
    io.stderr(`Unexpected arguments for 'serve': ${args.join(" ")}\n`);
    return 1;
  }

  let vaultPath: string;
  try {
    vaultPath = readConfig().vaultPath;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  // Open the index first, with its own error handling: openDatabase creates the
  // .dennoh dir and opens SQLite (and closes itself on internal failure), so a
  // failure here means there is no handle to clean up. Handling it before the
  // try/finally below keeps closeDatabase from ever running on an unopened db.
  let db: Database;
  try {
    db = openDatabase(vaultPath);
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  // From here the handle is open, so runMigrations and the server run under a
  // try/finally that always closes it — even if migration or startup throws.
  // runMigrations is idempotent (no-ops when the schema is current), so this
  // also covers a brand-new vault where `serve` first touches the database.
  try {
    runMigrations(db);
    const server = createMcpServer({ db, vaultPath });
    log.info("mcp: serving over stdio", { vaultPath });
    await startStdioServer(server);
    return 0;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  } finally {
    closeDatabase(db);
  }
}
