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
import { saveMemory } from "@/core/memory";
import { ContentValidationError } from "@/core/validate";
import { closeDatabase, openDatabase, runMigrations } from "@/db";

// Bilingual strings this command emits directly. Errors thrown by the core
// (config/validation/git) carry their own message and are rendered via
// readError; only the command-level help text is localized here, mirroring the
// status.ts pattern.
const MESSAGES: Record<Lang, { usage: string }> = {
  ja: { usage: '使い方: dennoh add "<本文>"\n' },
  en: { usage: 'Usage: dennoh add "<text>"\n' },
};

// `dennoh add "<text>"` — create a new note from its sole argument, or from
// stdin when no argument is given and the input is piped. This is a thin
// wrapper over `saveMemory`; all the file → DB → git work lives in core.
export async function addCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  // Prefer the positional argument. Only fall back to stdin when content was
  // not passed AND stdin is not an interactive terminal (i.e. piped or
  // redirected). `isTTY` is `true` only for a real TTY and `undefined` for a
  // pipe — never `false` — so the gate is `!== true`, not `=== false`. Reading
  // stdin on a TTY would block forever waiting for an EOF the user has no
  // reason to send, so that case is a usage error instead.
  let content: string;
  const arg = args[0];
  if (arg !== undefined) {
    content = arg;
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
    // Missing/invalid config ("run init first") is user-actionable, not an
    // internal malfunction.
    io.stderr(`${readError(e)}\n`);
    return EXIT_USER_ERROR;
  }

  // openDatabase creates the .dennoh dir and opens SQLite, closing itself on
  // internal failure; handle that before the try/finally so closeDatabase
  // never runs on an unopened handle. A failed open is an environmental
  // problem, so it exits with the internal-error code.
  let db: Database;
  try {
    db = openDatabase(vaultPath);
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  }

  try {
    // runMigrations is idempotent — it covers the brand-new-vault case where
    // `add` is the first command to touch the database.
    runMigrations(db);
    const id = await saveMemory(db, vaultPath, content);
    io.stdout(`${id}\n`);
    return EXIT_SUCCESS;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    // A rejected content (empty/oversize/binary) is the caller's mistake;
    // anything else escaping here is unexpected and counts as internal.
    return e instanceof ContentValidationError ? EXIT_USER_ERROR : EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
