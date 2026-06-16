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
import { searchMemory } from "@/core/memory";
import type { SearchFilters } from "@/db";
import { closeDatabase, openDatabase, runMigrations } from "@/db";

const DEFAULT_LIMIT = 20;

const MESSAGES: Record<
  Lang,
  { usage: string; badLimit: (got: string) => string; missingValue: (name: string) => string }
> = {
  ja: {
    usage: '使い方: dennoh search "<検索語>" [--project X] [--tag Y] [--limit N] [--json]\n',
    badLimit: (got) => `--limit は正の整数で指定してください (指定値: ${got})\n`,
    missingValue: (name) => `${name} には値が必要です\n`,
  },
  en: {
    usage: 'Usage: dennoh search "<query>" [--project X] [--tag Y] [--limit N] [--json]\n',
    badLimit: (got) => `--limit must be a positive integer (got ${got})\n`,
    missingValue: (name) => `${name} requires a value\n`,
  },
};

// `dennoh search "<query>" [--project X] [--tag Y] [--limit N] [--json]` —
// full-text search over the index. Default output is one line per hit
// (`<id> <title|snippet> <updatedAt>`); `--json` emits the raw result array.
// A thin wrapper over `searchMemory`.
export async function searchCommand(args: string[], io: CliIO): Promise<number> {
  const messages = MESSAGES[resolveLang()];

  const { present: json, rest: r1 } = takeBooleanFlag(args, "--json");
  const { value: project, present: projectGiven, rest: r2 } = takeOption(r1, "--project");
  const { value: tag, present: tagGiven, rest: r3 } = takeOption(r2, "--tag");
  const { value: limitArg, present: limitGiven, rest } = takeOption(r3, "--limit");

  // A flag that appeared without a value (e.g. `search foo --limit`) is a usage
  // error, not a silent fall-through to defaults. `present && value undefined`
  // is exactly that case.
  for (const [name, given, value] of [
    ["--project", projectGiven, project],
    ["--tag", tagGiven, tag],
    ["--limit", limitGiven, limitArg],
  ] as const) {
    if (given && value === undefined) {
      io.stderr(messages.missingValue(name));
      return EXIT_USER_ERROR;
    }
  }

  const query = rest[0];
  if (!query) {
    io.stderr(messages.usage);
    return EXIT_USER_ERROR;
  }

  // Parse --limit up-front so a malformed value is a clean usage error rather
  // than a confusing downstream slice. Absent --limit falls back to the
  // product default of 20.
  let limit = DEFAULT_LIMIT;
  if (limitArg !== undefined) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      io.stderr(messages.badLimit(limitArg));
      return EXIT_USER_ERROR;
    }
    limit = parsed;
  }

  // Only set filter keys that were actually provided so `searchMemory` joins
  // the present ones with AND and ignores the rest.
  const filters: SearchFilters = {};
  if (project !== undefined) {
    filters.project = project;
  }
  if (tag !== undefined) {
    filters.tag = tag;
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
    const results = searchMemory(db, query, filters, limit);

    if (json) {
      io.stdout(`${JSON.stringify(results, null, 2)}\n`);
      return EXIT_SUCCESS;
    }

    // One line per hit. Prefer the title; fall back to the FTS snippet when a
    // note has no title so the line is never blank in the middle column. The
    // snippet can contain embedded newlines (it is a slice of the body), so
    // collapse any whitespace run to a single space to preserve the
    // one-line-per-hit contract.
    for (const r of results) {
      const label = (r.title ?? r.snippet).replace(/\s+/g, " ").trim();
      io.stdout(`${r.id} ${label} ${r.updatedAt}\n`);
    }
    return EXIT_SUCCESS;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return EXIT_INTERNAL_ERROR;
  } finally {
    closeDatabase(db);
  }
}
