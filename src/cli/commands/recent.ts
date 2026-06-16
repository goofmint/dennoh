import type { Database } from "bun:sqlite";

import { takeBooleanFlag, takeOption } from "@/cli/flags";
import {
  type CliIO,
  EXIT_INTERNAL_ERROR,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  readError,
} from "@/cli/types";
import { type Lang, readConfig, resolveLang } from "@/config";
import { listRecent } from "@/core/memory";
import { closeDatabase, openDatabase, runMigrations } from "@/db";

const DEFAULT_LIMIT = 10;

const MESSAGES: Record<
  Lang,
  {
    unexpectedArgs: (args: string) => string;
    badLimit: (got: string) => string;
    missingValue: (name: string) => string;
  }
> = {
  ja: {
    unexpectedArgs: (a) => `'recent' に予期しない引数があります: ${a}\n`,
    badLimit: (got) => `--limit は正の整数で指定してください (指定値: ${got})\n`,
    missingValue: (name) => `${name} には値が必要です\n`,
  },
  en: {
    unexpectedArgs: (a) => `Unexpected arguments for 'recent': ${a}\n`,
    badLimit: (got) => `--limit must be a positive integer (got ${got})\n`,
    missingValue: (name) => `${name} requires a value\n`,
  },
};

// `dennoh recent [--limit N] [--json]` — list the most-recently-updated notes.
// Default output is one line per note (`<id> <title|path> <updated_at>`);
// `--json` emits the rows with their JSON columns deserialized. A thin wrapper
// over `listRecent`, which returns raw NoteRow metadata (no body reads).
export async function recentCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  const { present: json, rest: r1 } = takeBooleanFlag(args, "--json");
  const { value: limitArg, present: limitGiven, rest } = takeOption(r1, "--limit");

  // `--limit` with no value (e.g. `recent --limit`) is a usage error, not a
  // silent fall-through to the default.
  if (limitGiven && limitArg === undefined) {
    io.stderr(messages.missingValue("--limit"));
    return EXIT_USER_ERROR;
  }

  if (rest.length > 0) {
    io.stderr(messages.unexpectedArgs(rest.join(" ")));
    return EXIT_USER_ERROR;
  }

  let limit = DEFAULT_LIMIT;
  if (limitArg !== undefined) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      io.stderr(messages.badLimit(limitArg));
      return EXIT_USER_ERROR;
    }
    limit = parsed;
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
    const rows = listRecent(db, limit);

    if (json) {
      // projects_json / tags_json are stored as serialized arrays; deserialize
      // them so JSON consumers get real arrays instead of escaped strings. The
      // raw *_json columns are dropped in favor of the parsed `projects` /
      // `tags` fields.
      const out = rows.map((row) => {
        const { projects_json, tags_json, ...fields } = row;
        return {
          ...fields,
          projects: JSON.parse(projects_json) as string[],
          tags: JSON.parse(tags_json) as string[],
        };
      });
      io.stdout(`${JSON.stringify(out, null, 2)}\n`);
      return EXIT_SUCCESS;
    }

    // One line per note. Prefer the title; fall back to the path when a note
    // has no title so the middle column is never blank.
    for (const row of rows) {
      const label = row.title ?? row.path;
      io.stdout(`${row.id} ${label} ${row.updated_at}\n`);
    }
    return EXIT_SUCCESS;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
