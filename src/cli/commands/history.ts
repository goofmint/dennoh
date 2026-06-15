import type { CliIO } from "@/cli/types";
import { readConfig } from "@/config";
import { closeDatabase, getNoteById, openDatabase } from "@/db";
import { gitLog } from "@/git";

function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// `dennoh history <id>` — print the git commit history of a single note,
// newest first. The note's on-disk path is resolved through the DB rather
// than re-derived from the id so a soft-deleted or unknown id fails cleanly
// before any git walk is attempted.
export async function historyCommand(args: string[], io: CliIO): Promise<number> {
  const id = args[0];
  if (!id) {
    io.stderr("Usage: dennoh history <id>\n");
    return 1;
  }

  let vaultPath: string;
  try {
    vaultPath = readConfig().vaultPath;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  const db = openDatabase(vaultPath);
  try {
    // getNoteById filters `deleted_at IS NULL`, so a null here means the note
    // is either unknown or already soft-deleted; both are reported the same
    // way because the history surface has no reason to distinguish them.
    const row = getNoteById(db, id);
    if (row === null) {
      io.stderr(`note not found or already deleted (id=${id})\n`);
      return 1;
    }

    const commits = await gitLog(vaultPath, row.path);
    for (const commit of commits) {
      // `<sha 7 chars> <ISO timestamp> <message>` — one line per commit. The
      // 7-char prefix matches git's conventional short-SHA length and is the
      // exact token `dennoh restore` accepts back.
      io.stdout(`${commit.sha.slice(0, 7)} ${commit.timestamp.toISOString()} ${commit.message}\n`);
    }
    return 0;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  } finally {
    closeDatabase(db);
  }
}
