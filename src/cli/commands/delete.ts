import type { Database } from "bun:sqlite";

import {
  type CliIO,
  EXIT_INTERNAL_ERROR,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  isNotFoundError,
  readError,
} from "@/cli/types";
import { type Lang, readConfig, resolveLang } from "@/config";
import { deleteMemory } from "@/core/memory";
import { closeDatabase, getNoteById, openDatabase, runMigrations } from "@/db";

const MESSAGES: Record<
  Lang,
  { usage: string; notFound: (id: string) => string; success: (id: string) => string }
> = {
  ja: {
    usage: "使い方: dennoh delete <id>\n",
    notFound: (id) => `メモが見つからないか、既に削除されています (id=${id})\n`,
    success: (id) => `削除しました ${id}\n`,
  },
  en: {
    usage: "Usage: dennoh delete <id>\n",
    notFound: (id) => `note not found or already deleted (id=${id})\n`,
    success: (id) => `deleted ${id}\n`,
  },
};

// `dennoh delete <id>` — soft-delete a note (remove the file, stamp deleted_at,
// record a git commit). A thin wrapper over `deleteMemory`.
export async function deleteCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  const id = args[0];
  if (!id) {
    io.stderr(messages.usage);
    return EXIT_USER_ERROR;
  }

  let vaultPath: string;
  try {
    vaultPath = readConfig().vaultPath;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_USER_ERROR;
  }

  let db: Database;
  try {
    db = openDatabase(vaultPath);
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  }

  try {
    runMigrations(db);

    // Pre-check existence so an unknown or already-deleted id is a user error,
    // not a generic throw out of deleteMemory that would read as internal.
    if (getNoteById(db, id) === null) {
      io.stderr(messages.notFound(id));
      return EXIT_USER_ERROR;
    }

    await deleteMemory(db, vaultPath, id);
    io.stdout(messages.success(id));
    return EXIT_SUCCESS;
  } catch (e) {
    // The pre-check covers the common missing-id case; this guards the TOCTOU
    // race where the note is deleted between that check and deleteMemory. Only
    // a genuine not-found maps to a user error — a mid-delete failure (e.g. a
    // git error after the soft delete) does not match and stays internal.
    if (isNotFoundError(e)) {
      io.stderr(messages.notFound(id));
      return EXIT_USER_ERROR;
    }
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
