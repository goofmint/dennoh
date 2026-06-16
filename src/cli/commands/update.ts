import type { Database } from "bun:sqlite";

import { readStdin } from "@/cli/stdin";
import {
  type CliIO,
  EXIT_INTERNAL_ERROR,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  readError,
} from "@/cli/types";
import { type Lang, readConfig, resolveLang } from "@/config";
import { updateMemory } from "@/core/memory";
import { ContentValidationError } from "@/core/validate";
import { closeDatabase, getNoteById, openDatabase, runMigrations } from "@/db";

const MESSAGES: Record<
  Lang,
  { usage: string; notFound: (id: string) => string; success: (id: string) => string }
> = {
  ja: {
    usage: '使い方: dennoh update <id> "<本文>"\n',
    notFound: (id) => `メモが見つからないか、既に削除されています (id=${id})\n`,
    success: (id) => `更新しました ${id}\n`,
  },
  en: {
    usage: 'Usage: dennoh update <id> "<text>"\n',
    notFound: (id) => `note not found or already deleted (id=${id})\n`,
    success: (id) => `updated ${id}\n`,
  },
};

// `dennoh update <id> "<text>"` — replace a note's content. Text may be passed
// as the second argument or piped on stdin. A thin wrapper over `updateMemory`,
// which performs the file → DB → git update.
export async function updateCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  const id = args[0];
  if (!id) {
    io.stderr(messages.usage);
    return EXIT_USER_ERROR;
  }

  // Second positional is the new text; fall back to stdin only when it is
  // absent AND stdin is not an interactive terminal (piped or redirected),
  // mirroring `add`. `isTTY` is `true` only for a real TTY and `undefined` for
  // a pipe — never `false` — so the gate is `!== true`. On a TTY with no text
  // argument, reading would block forever, so that is a usage error.
  let content: string;
  const textArg = args[1];
  if (textArg !== undefined) {
    content = textArg;
  } else if (process.stdin.isTTY !== true) {
    content = await readStdin();
  } else {
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

    // Pre-check existence here (as history/restore do) so an unknown or
    // already-deleted id is reported as a user error rather than escaping the
    // mutation as a generic throw that would read as internal.
    if (getNoteById(db, id) === null) {
      io.stderr(messages.notFound(id));
      return EXIT_USER_ERROR;
    }

    await updateMemory(db, vaultPath, id, content);
    io.stdout(messages.success(id));
    return EXIT_SUCCESS;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return e instanceof ContentValidationError ? EXIT_USER_ERROR : EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
