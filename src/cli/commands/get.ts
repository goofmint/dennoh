import type { Database } from "bun:sqlite";

import { takeBooleanFlag } from "@/cli/flags";
import {
  type CliIO,
  EXIT_INTERNAL_ERROR,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  readError,
} from "@/cli/types";
import { type Lang, readConfig, resolveLang } from "@/config";
import { getNote } from "@/core/memory";
import { closeDatabase, openDatabase, runMigrations } from "@/db";

// Only the help and not-found prose is localized. The frontmatter field labels
// in the human-readable view (`id:`, `created:`, …) are language-neutral data
// keys — like a YAML dump — so they stay constant in both languages.
const MESSAGES: Record<Lang, { usage: string; notFound: (id: string) => string }> = {
  ja: {
    usage: "使い方: dennoh get <id> [--json]\n",
    notFound: (id) => `メモが見つかりません (id=${id})\n`,
  },
  en: {
    usage: "Usage: dennoh get <id> [--json]\n",
    notFound: (id) => `note not found (id=${id})\n`,
  },
};

// `dennoh get <id> [--json]` — print a single note. The default rendering is a
// human-readable header (id + frontmatter fields) followed by the body; with
// `--json` the whole NoteRead object is emitted verbatim for tooling. A thin
// wrapper over `getNote`, which resolves the on-disk path through the DB.
export async function getCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  const { present: json, rest } = takeBooleanFlag(args, "--json");
  const id = rest[0];
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
    // getNote returns null for an unknown or soft-deleted id (the DB lookup
    // filters `deleted_at IS NULL`); both collapse into one "not found".
    const result = await getNote(db, vaultPath, id);
    if (result === null) {
      io.stderr(messages.notFound(id));
      return EXIT_USER_ERROR;
    }

    if (json) {
      io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      return EXIT_SUCCESS;
    }

    // Human-readable form: id + frontmatter fields, a blank line, then the
    // body exactly as stored. projects/tags are joined with ", " so an empty
    // list renders as an empty value rather than "[]".
    const { frontmatter, body } = result;
    io.stdout(`id: ${result.id}\n`);
    io.stdout(`created: ${frontmatter.createdAt}\n`);
    io.stdout(`updated: ${frontmatter.updatedAt}\n`);
    io.stdout(`source: ${frontmatter.source}\n`);
    io.stdout(`projects: ${frontmatter.projects.join(", ")}\n`);
    io.stdout(`tags: ${frontmatter.tags.join(", ")}\n`);
    io.stdout(`\n${body}`);
    if (!body.endsWith("\n")) {
      io.stdout("\n");
    }
    return EXIT_SUCCESS;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
