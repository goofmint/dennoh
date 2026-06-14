import type { Database } from "bun:sqlite";

// Per-version migration step. A migration is responsible only for moving the
// database from (version-1) to (version); `runMigrations` handles the wrapping
// transaction and the `schema_version` bookkeeping.
type Migration = (db: Database) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT,
        projects_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]'
      );
    `);

    // External-content FTS5: tokens are stored here, original text is read
    // from `notes` for snippet() expansion. unicode61 is required for
    // Japanese/CJK content — the default tokenizer splits on ASCII only and
    // produces empty token streams for tags like `#日記`. `remove_diacritics=0`
    // keeps Vietnamese / accented Latin content searchable in original form.
    db.exec(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        content='notes',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 0'
      );
    `);

    // SQLite does NOT auto-sync external-content FTS5; the standard pattern is
    // these three triggers. They keep `notes_fts` in lockstep with `notes`
    // (currently the `title` column) so the repository layer can issue plain
    // INSERT/UPDATE/DELETE against `notes` without separately touching FTS.
    // The 'delete' control row removes the prior tokens before a new row's
    // tokens are inserted — the documented SQLite FTS5 update idiom.
    db.exec(`
      CREATE TRIGGER notes_after_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title) VALUES (new.rowid, new.title);
      END;
      CREATE TRIGGER notes_after_delete AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title) VALUES('delete', old.rowid, old.title);
      END;
      CREATE TRIGGER notes_after_update AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title) VALUES('delete', old.rowid, old.title);
        INSERT INTO notes_fts(rowid, title) VALUES (new.rowid, new.title);
      END;
    `);
  },
  2: (db) => {
    // Soft-delete column. Rows are kept after `softDeleteNote` so that history
    // (git log, mobile clients) can still resolve the id, while read-paths
    // hide them via `WHERE deleted_at IS NULL`. NULL means "live", an ISO 8601
    // timestamp means "deleted at that moment". Hard `deleteNote` is retained
    // for internal use (tests, true purge) and bypasses this column.
    db.exec("ALTER TABLE notes ADD COLUMN deleted_at TEXT;");
  },
  3: (db) => {
    // Add the original `body` (Japanese / source language) and `body_en`
    // (JA→EN machine translation) columns. NOT NULL DEFAULT '' so existing
    // v2 rows pick up empty strings without manual backfill; new writes
    // populate both via `toNoteRow`. Translation is performed in
    // `saveMemory` / `updateMemory` via `@/translate`, with empty string
    // on failure (translation is optional and must not block saves).
    db.exec(
      "ALTER TABLE notes ADD COLUMN body TEXT NOT NULL DEFAULT '';" +
        "ALTER TABLE notes ADD COLUMN body_en TEXT NOT NULL DEFAULT '';"
    );

    // FTS5 only supports a *single* tokenizer per virtual table — we cannot
    // mix `unicode61` for English-friendly columns with a CJK-aware
    // tokenizer for body. `unicode61 remove_diacritics 0` is the chosen
    // single tokenizer: it splits on non-letter characters and lowercases,
    // which is correct for ASCII / accented Latin and leaves Vietnamese
    // queryable in its original diacritics.
    //
    // Known limitation: unicode61 treats runs of CJK letters as a single
    // token. Japanese sub-token search (e.g., querying `日記` against the
    // body `今日の日記とメモ`) will NOT match — the run is one token.
    // English search against `body_en` works normally; this is why the
    // JA→EN translation column is the primary path for cross-language
    // search. A future migration can swap to the FTS5 `trigram` tokenizer
    // to fix Japanese substring search at the cost of larger indexes.
    //
    // The migration drops the title-only v1 FTS, rebuilds it with title +
    // body + body_en, and re-creates the sync triggers to mirror the new
    // column set. Existing live rows are re-inserted so the index picks
    // up their (empty) body / body_en defaults plus the preserved title.
    db.exec(
      "DROP TRIGGER IF EXISTS notes_after_insert;" +
        "DROP TRIGGER IF EXISTS notes_after_delete;" +
        "DROP TRIGGER IF EXISTS notes_after_update;" +
        "DROP TABLE IF EXISTS notes_fts;"
    );

    db.exec(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        body,
        body_en,
        content='notes',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 0'
      );
    `);

    // The three trigger bodies use INSERT…SELECT…WHERE so they only
    // touch notes_fts when the row's live-state actually requires it.
    // Invariant: notes_fts contains exactly one entry per row whose
    // deleted_at IS NULL. The transitions:
    //   - INSERT live row             → add to FTS
    //   - UPDATE live → live          → replace FTS entry
    //   - UPDATE live → soft-deleted  → remove FTS entry
    //   - UPDATE soft → live (undo)   → add FTS entry
    //   - DELETE live row             → remove FTS entry
    //   - DELETE soft-deleted row     → no-op (FTS already empty)
    // Without the conditional 'delete' on hard-delete, a hard delete that
    // follows a soft delete tries to 'delete' a rowid no longer in FTS
    // and corrupts the index ("database disk image is malformed").
    db.exec(`
      CREATE TRIGGER notes_after_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body, body_en)
        SELECT new.rowid, new.title, new.body, new.body_en
        WHERE new.deleted_at IS NULL;
      END;
      CREATE TRIGGER notes_after_delete AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body, body_en)
        SELECT 'delete', old.rowid, old.title, old.body, old.body_en
        WHERE old.deleted_at IS NULL;
      END;
      CREATE TRIGGER notes_after_update AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body, body_en)
        SELECT 'delete', old.rowid, old.title, old.body, old.body_en
        WHERE old.deleted_at IS NULL;
        INSERT INTO notes_fts(rowid, title, body, body_en)
        SELECT new.rowid, new.title, new.body, new.body_en
        WHERE new.deleted_at IS NULL;
      END;
    `);

    // Repopulate FTS from existing live rows. v2 rows have body='' /
    // body_en='' from the DEFAULTs above, so this restores title-only
    // searchability and leaves body indexing empty until the user re-saves.
    db.exec(`
      INSERT INTO notes_fts(rowid, title, body, body_en)
      SELECT rowid, title, body, body_en FROM notes WHERE deleted_at IS NULL;
    `);
  },
  // Future migration patterns to follow when extending this map:
  //   4: (db) => { db.exec("CREATE INDEX ... ON notes(...)"); }       // index add
  //   5: (db) => { /* data transform: SELECT old, INSERT new, etc. */ } // data transform
};

const SCHEMA_VERSION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

// Returns 0 when the bookkeeping table does not yet exist, so first-time
// callers do not have to special-case fresh databases. After bootstrap,
// returns MAX(version) — using MAX rather than ORDER BY lets future code
// safely apply migrations out of order during testing if it ever needs to.
export function getCurrentVersion(db: Database): number {
  const tableCheck = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"
    )
    .get();
  if (tableCheck === null) {
    return 0;
  }
  const row = db
    .query<{ version: number | null }, []>("SELECT MAX(version) AS version FROM schema_version")
    .get();
  return row?.version ?? 0;
}

export function runMigrations(db: Database): void {
  db.exec(SCHEMA_VERSION_TABLE_SQL);

  const targetVersion = Math.max(...Object.keys(MIGRATIONS).map(Number));
  let currentVersion = getCurrentVersion(db);

  if (currentVersion > targetVersion) {
    throw new Error(
      `DB schema version ${currentVersion} is newer than the binary's target version ${targetVersion}; cannot migrate`
    );
  }

  // Idempotency: every iteration only advances when the migration for the
  // next slot is registered. Re-running `runMigrations` on an up-to-date DB
  // immediately falls through the `while` because currentVersion already
  // equals targetVersion.
  while (currentVersion < targetVersion) {
    const nextVersion = currentVersion + 1;
    const migration = MIGRATIONS[nextVersion];
    if (migration === undefined) {
      throw new Error(`Missing migration for version ${nextVersion}`);
    }

    const tx = db.transaction(() => {
      migration(db);
      db.query("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        nextVersion,
        new Date().toISOString()
      );
    });
    tx();

    currentVersion = nextVersion;
  }
}
