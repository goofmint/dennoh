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
  // Future migration patterns to follow when extending this map:
  //   2: (db) => { db.exec("ALTER TABLE notes ADD COLUMN ..."); }     // column add
  //   3: (db) => { db.exec("CREATE INDEX ... ON notes(...)"); }       // index add
  //   4: (db) => { /* data transform: SELECT old, INSERT new, etc. */ } // data transform
  //   5: (db) => {                                                     // FTS rebuild
  //        db.exec("DROP TABLE notes_fts;");
  //        db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(...);");
  //        db.exec("INSERT INTO notes_fts(rowid, title) SELECT rowid, title FROM notes;");
  //      }
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
