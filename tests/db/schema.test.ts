import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { closeDatabase, openDatabase } from "@/db/connection";
import { runMigrations } from "@/db/schema";

function tableColumns(db: Database, table: string): string[] {
  // `pragma_table_info(?)` is the table-function form of PRAGMA table_info,
  // which accepts a bound parameter. Avoids string-interpolating the table
  // name into the SQL so this helper stays safe if it's ever reused with
  // dynamic input.
  return db
    .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
    .all(table)
    .map((r) => r.name);
}

function ftsColumnSql(db: Database): string {
  const row = db
    .query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_fts'"
    )
    .get();
  return row?.sql ?? "";
}

describe("db/schema migration v3", () => {
  let vaultPath: string;
  let db: Database;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-schema-"));
    db = openDatabase(vaultPath);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("column additions", () => {
    it("adds notes.body and notes.body_en after runMigrations", () => {
      runMigrations(db);
      const cols = tableColumns(db, "notes");
      expect(cols).toContain("body");
      expect(cols).toContain("body_en");
    });

    it("makes body / body_en NOT NULL with default '' so existing v2 rows survive the ALTER", () => {
      runMigrations(db);
      // Inserting without specifying body / body_en succeeds because DEFAULT '' fills both.
      db.exec(`
        INSERT INTO notes (id, path, created_at, updated_at, source, title, projects_json, tags_json)
        VALUES ('id-1', '/vault/a.md', '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00', 'note', 't', '[]', '[]');
      `);
      const row = db
        .query<{ body: string; body_en: string }, []>(
          "SELECT body, body_en FROM notes WHERE id = 'id-1'"
        )
        .get();
      expect(row?.body).toBe("");
      expect(row?.body_en).toBe("");
    });
  });

  describe("notes_fts indexing", () => {
    it("indexes title, body, and body_en after runMigrations", () => {
      runMigrations(db);
      const sql = ftsColumnSql(db);
      // The CREATE VIRTUAL TABLE statement names every FTS column explicitly;
      // we assert their presence in the recorded DDL rather than introspect
      // an FTS5 PRAGMA (which doesn't list virtual-table columns by name).
      expect(sql).toMatch(/\btitle\b/);
      expect(sql).toMatch(/\bbody\b/);
      expect(sql).toMatch(/\bbody_en\b/);
    });

    it("uses unicode61 remove_diacritics 0 tokenizer", () => {
      runMigrations(db);
      const sql = ftsColumnSql(db);
      expect(sql).toMatch(/unicode61 remove_diacritics 0/);
    });
  });

  describe("v2 → v3 data preservation", () => {
    // Build the v2 state by hand (notes table without body / body_en, FTS
    // with title only, triggers per v1, schema_version=2). Then apply
    // runMigrations() — it should detect currentVersion=2 and apply only
    // migration v3, preserving the existing row.
    function setupV2State(): void {
      db.exec(`
        CREATE TABLE schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_version VALUES (1, '2026-01-01T00:00:00Z');
        INSERT INTO schema_version VALUES (2, '2026-01-02T00:00:00Z');

        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          source TEXT NOT NULL,
          title TEXT,
          projects_json TEXT NOT NULL DEFAULT '[]',
          tags_json TEXT NOT NULL DEFAULT '[]',
          deleted_at TEXT
        );

        CREATE VIRTUAL TABLE notes_fts USING fts5(
          title,
          content='notes',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 0'
        );

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

        INSERT INTO notes (id, path, created_at, updated_at, source, title, projects_json, tags_json)
        VALUES (
          'legacy-id',
          '/vault/legacy.md',
          '2026-01-01T00:00:00+09:00',
          '2026-01-01T00:00:00+09:00',
          'note',
          'LegacyTitle',
          '["legacy-project"]',
          '["legacy-tag"]'
        );
      `);
    }

    it("preserves existing rows when advancing v2 → v3", () => {
      setupV2State();
      runMigrations(db);

      const row = db
        .query<
          {
            id: string;
            title: string;
            body: string;
            body_en: string;
            projects_json: string;
            tags_json: string;
          },
          []
        >(
          "SELECT id, title, body, body_en, projects_json, tags_json FROM notes WHERE id = 'legacy-id'"
        )
        .get();
      expect(row?.id).toBe("legacy-id");
      expect(row?.title).toBe("LegacyTitle");
      // New columns default to "" for legacy rows.
      expect(row?.body).toBe("");
      expect(row?.body_en).toBe("");
      // Preexisting metadata untouched.
      expect(row?.projects_json).toBe('["legacy-project"]');
      expect(row?.tags_json).toBe('["legacy-tag"]');
    });

    it("rebuilds notes_fts so title remains searchable on preserved rows after v3", () => {
      setupV2State();
      runMigrations(db);

      // The migration's INSERT INTO notes_fts ... SELECT step re-seeds the
      // new FTS table with the existing live rows. Title should still find
      // the legacy row.
      const matches = db
        .query<{ id: string }, [string]>(
          "SELECT notes.id FROM notes_fts JOIN notes ON notes.rowid = notes_fts.rowid WHERE notes_fts MATCH ?"
        )
        .all("LegacyTitle");
      expect(matches.map((m) => m.id)).toEqual(["legacy-id"]);
    });

    it("advances schema_version to 3 without re-applying v1 / v2", () => {
      setupV2State();
      runMigrations(db);

      const versions = db
        .query<{ version: number }, []>("SELECT version FROM schema_version ORDER BY version")
        .all()
        .map((r) => r.version);
      expect(versions).toEqual([1, 2, 3]);
    });
  });
});
