import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeNote } from "@/core/file";
import type { NoteFrontmatter } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import { reindexAll } from "@/db/reindex";
import { runMigrations } from "@/db/schema";

function fm(overrides: Partial<NoteFrontmatter> = {}): NoteFrontmatter {
  return {
    createdAt: "2026-06-12T10:00:00+09:00",
    updatedAt: "2026-06-12T10:05:00+09:00",
    source: "note",
    title: "T",
    projects: [],
    tags: [],
    ...overrides,
  };
}

function notesCount(db: Database): number {
  const row = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM notes").get();
  return row?.c ?? 0;
}

describe("db/reindex", () => {
  let vaultPath: string;
  let db: Database;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-reindex-"));
    db = openDatabase(vaultPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("reindexAll", () => {
    it("indexes every .md file in the vault — row count matches file count (T4.5)", async () => {
      // Lay down N files via the production write path so frontmatter is
      // serialized the same way the CLI/MCP layer would write it.
      const ids = [generateId(), generateId(), generateId()];
      const dates = [new Date(2026, 5, 12), new Date(2026, 5, 13), new Date(2026, 5, 14)];
      const pairs = ids.map((id, i) => [id, dates[i]!, i] as const);
      for (const [idValue, dateValue, i] of pairs) {
        await writeNote(vaultPath, idValue, dateValue, fm({ title: `t${i}` }), `body ${i}`);
      }

      // Fresh DB — no preexisting rows.
      expect(notesCount(db)).toBe(0);

      const result = await reindexAll(db, vaultPath);

      expect(result.processed).toBe(ids.length);
      expect(result.errors).toEqual([]);
      expect(notesCount(db)).toBe(ids.length);
    });

    it("clears existing rows before rebuilding so stale entries are removed", async () => {
      const id = generateId();
      await writeNote(vaultPath, id, new Date(2026, 5, 12), fm(), "body");
      await reindexAll(db, vaultPath);
      expect(notesCount(db)).toBe(1);

      // Remove the file behind the DB's back, then re-reindex.
      fs.rmSync(path.join(vaultPath, "2026", "06", "12", `${id}.md`));
      const result = await reindexAll(db, vaultPath);

      expect(result.processed).toBe(0);
      expect(notesCount(db)).toBe(0);
    });

    it("completes without error on an empty vault", async () => {
      const result = await reindexAll(db, vaultPath);
      expect(result.processed).toBe(0);
      expect(result.errors).toEqual([]);
      expect(notesCount(db)).toBe(0);
    });

    it("skips .dennoh/ contents so the DB file itself is not scanned", async () => {
      // The vault already contains .dennoh/index.db (created by openDatabase).
      // If the walker descended into .dennoh, it would either treat index.db
      // as a non-.md (filtered) or fail on a stray .md — either way, drop a
      // bogus .md inside .dennoh to make the assertion concrete.
      const dennohMd = path.join(vaultPath, ".dennoh", "should-not-index.md");
      fs.writeFileSync(dennohMd, "---\n---\nbody");

      const result = await reindexAll(db, vaultPath);
      expect(result.processed).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });
});
