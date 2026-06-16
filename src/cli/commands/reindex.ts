import type { Database } from "bun:sqlite";

import {
  type CliIO,
  EXIT_INTERNAL_ERROR,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  readError,
} from "@/cli/types";
import { type Lang, readConfig, resolveLang } from "@/config";
import { closeDatabase, openDatabase, reindexAll, runMigrations } from "@/db";

const MESSAGES: Record<
  Lang,
  {
    unexpectedArgs: (args: string) => string;
    summary: (processed: number, errors: number, translationErrors: number) => string;
    error: (path: string, message: string) => string;
    translationError: (path: string, message: string) => string;
  }
> = {
  ja: {
    unexpectedArgs: (a) => `'reindex' に予期しない引数があります: ${a}\n`,
    summary: (p, e, t) =>
      `${p} 件のメモを再インデックスしました。エラー ${e} 件、翻訳エラー ${t} 件\n`,
    error: (path, message) => `  エラー: ${path}: ${message}\n`,
    translationError: (path, message) => `  翻訳エラー: ${path}: ${message}\n`,
  },
  en: {
    unexpectedArgs: (a) => `Unexpected arguments for 'reindex': ${a}\n`,
    summary: (p, e, t) => `reindexed ${p} note(s); ${e} error(s), ${t} translation error(s)\n`,
    error: (path, message) => `  error: ${path}: ${message}\n`,
    translationError: (path, message) => `  translation error: ${path}: ${message}\n`,
  },
};

// `dennoh reindex` — rebuild the SQLite index from the on-disk notes. The core
// `reindexAll` clears the `notes` table and re-walks the vault, recording
// per-file failures rather than aborting. This wrapper prints a summary of the
// counts plus the details of any errors encountered.
export async function reindexCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  if (args.length > 0) {
    io.stderr(messages.unexpectedArgs(args.join(" ")));
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
    // runMigrations before reindexAll: the latter immediately `DELETE`s from
    // `notes`, which requires the schema to exist. This makes `reindex` safe to
    // run as the first command against a brand-new vault.
    runMigrations(db);
    const result = await reindexAll(db, vaultPath);

    io.stdout(
      messages.summary(result.processed, result.errors.length, result.translationErrors.length)
    );

    // Surface the specifics so a failed file is actionable. Read errors and
    // translation errors are reported in separate sections because they mean
    // different things (could not index vs. indexed without a translation).
    for (const { path, message } of result.errors) {
      io.stdout(messages.error(path, message));
    }
    for (const { path, message } of result.translationErrors) {
      io.stdout(messages.translationError(path, message));
    }
    return EXIT_SUCCESS;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
