import { type CliIO, readError } from "@/cli/types";
import { readConfig } from "@/config";
import { closeDatabase, openDatabase } from "@/db";
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

  // Open the index up front. Tools added in later phases (T10.4+) run against
  // this handle; for now it is held open for the server's lifetime and closed
  // when the transport shuts down.
  const db = openDatabase(vaultPath);
  const server = createMcpServer({ db, vaultPath });
  try {
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
