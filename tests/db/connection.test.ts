import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DENNOH_DIR } from "@/core/path";
import { closeDatabase, openDatabase } from "@/db/connection";
import { getCurrentVersion, runMigrations } from "@/db/schema";

type SqliteMasterRow = { name: string };

function listTables(db: ReturnType<typeof openDatabase>): string[] {
  return db
    .query<SqliteMasterRow, []>("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
    .all()
    .map((r) => r.name);
}

describe("db/connection", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-db-"));
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("openDatabase", () => {
    it("supports the basic connect → query → close cycle", () => {
      const db = openDatabase(vaultPath);
      try {
        const row = db.query<{ answer: number }, []>("SELECT 1 AS answer").get();
        expect(row?.answer).toBe(1);
      } finally {
        closeDatabase(db);
      }
    });

    it("creates the .dennoh directory and index.db file automatically", () => {
      const dennohDir = path.join(vaultPath, DENNOH_DIR);
      expect(fs.existsSync(dennohDir)).toBe(false);

      const db = openDatabase(vaultPath);
      try {
        expect(fs.existsSync(dennohDir)).toBe(true);
        expect(fs.existsSync(path.join(dennohDir, "index.db"))).toBe(true);
      } finally {
        closeDatabase(db);
      }
    });

    it("enables foreign_keys for the connection", () => {
      const db = openDatabase(vaultPath);
      try {
        const row = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
        expect(row?.foreign_keys).toBe(1);
      } finally {
        closeDatabase(db);
      }
    });
  });

  describe("runMigrations", () => {
    it("creates notes, notes_fts, and schema_version after the first run", () => {
      const db = openDatabase(vaultPath);
      try {
        runMigrations(db);

        const tables = listTables(db);
        expect(tables).toContain("notes");
        expect(tables).toContain("notes_fts");
        expect(tables).toContain("schema_version");

        expect(getCurrentVersion(db)).toBe(3);
      } finally {
        closeDatabase(db);
      }
    });

    it("is idempotent: a second invocation does not re-apply migrations", () => {
      const db = openDatabase(vaultPath);
      try {
        runMigrations(db);

        const firstRows = db
          .query<{ version: number; applied_at: string }, []>(
            "SELECT version, applied_at FROM schema_version ORDER BY version"
          )
          .all();
        expect(firstRows.length).toBe(3);

        runMigrations(db);

        const secondRows = db
          .query<{ version: number; applied_at: string }, []>(
            "SELECT version, applied_at FROM schema_version ORDER BY version"
          )
          .all();
        expect(secondRows).toEqual(firstRows);
        expect(getCurrentVersion(db)).toBe(3);
      } finally {
        closeDatabase(db);
      }
    });
  });
});
