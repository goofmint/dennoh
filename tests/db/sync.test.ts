// Disable the translation pipeline so the default scanAndSync path doesn't
// kick off a 300MB model download. The DI-based mock tests below pass their
// own translator and ignore this flag.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { writeNote } from "@/core/file";
import { buildNotePath } from "@/core/path";
import type { NoteFrontmatter } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import { reindexAll } from "@/db/reindex";
import { getNoteById, searchNotes } from "@/db/repository";
import { runMigrations } from "@/db/schema";
import { scanAndSync } from "@/db/sync";

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

// Push the file's mtime well past any updated_at the DB might be holding so
// the diff predicate (mtime > updated_at) fires deterministically — uses
// utimes to avoid depending on real wall-clock latency between writes.
function bumpMtime(filePath: string, secondsFromNow = 600): void {
  const future = (Date.now() + secondsFromNow * 1000) / 1000;
  fs.utimesSync(filePath, future, future);
}

describe("db/sync", () => {
  let vaultPath: string;
  let db: Database;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-sync-"));
    db = openDatabase(vaultPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("scanAndSync", () => {
    it("reflects external file edits — UPDATE updates updated_at (T4.6)", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 12);
      await writeNote(vaultPath, id, date, fm({ updatedAt: "2026-06-12T10:00:00+09:00" }), "v1");
      await reindexAll(db, vaultPath);

      const before = getNoteById(db, id);
      expect(before?.updated_at).toBe("2026-06-12T10:00:00+09:00");

      const newUpdatedAt = "2026-06-12T15:00:00+09:00";
      await writeNote(vaultPath, id, date, fm({ updatedAt: newUpdatedAt }), "v2");
      bumpMtime(buildNotePath(vaultPath, id, date));

      const result = await scanAndSync(db, vaultPath);
      expect(result.updated).toBe(1);
      expect(result.added).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.errors).toEqual([]);

      const after = getNoteById(db, id);
      expect(after?.updated_at).toBe(newUpdatedAt);
    });

    it("picks up externally added files as INSERTs", async () => {
      expect(notesCount(db)).toBe(0);

      const id = generateId();
      const date = new Date(2026, 5, 13);
      await writeNote(vaultPath, id, date, fm(), "fresh body");

      const result = await scanAndSync(db, vaultPath);
      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(notesCount(db)).toBe(1);
      expect(getNoteById(db, id)?.id).toBe(id);
    });

    it("removes DB rows whose files were externally deleted", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 14);
      await writeNote(vaultPath, id, date, fm(), "body");
      await reindexAll(db, vaultPath);
      expect(notesCount(db)).toBe(1);

      fs.rmSync(buildNotePath(vaultPath, id, date));

      const result = await scanAndSync(db, vaultPath);
      expect(result.deleted).toBe(1);
      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(notesCount(db)).toBe(0);
      expect(getNoteById(db, id)).toBeNull();
    });

    it("handles a no-change scan of an empty vault", async () => {
      const result = await scanAndSync(db, vaultPath);
      expect(result).toEqual({
        added: 0,
        updated: 0,
        deleted: 0,
        errors: [],
        translationErrors: [],
      });
    });

    it("accumulates errors for invalid updatedAt and continues processing valid files", async () => {
      const validId = generateId();
      const invalidId = generateId();
      const date = new Date(2026, 5, 12);

      await writeNote(
        vaultPath,
        validId,
        date,
        fm({ updatedAt: "2026-06-12T10:00:00+09:00" }),
        "valid body"
      );
      await writeNote(vaultPath, invalidId, date, fm({ updatedAt: "not-a-date" }), "invalid body");

      bumpMtime(buildNotePath(vaultPath, validId, date));
      bumpMtime(buildNotePath(vaultPath, invalidId, date));

      const result = await scanAndSync(db, vaultPath);

      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe(buildNotePath(vaultPath, invalidId, date));

      expect(getNoteById(db, validId)?.id).toBe(validId);
      expect(getNoteById(db, invalidId)).toBeNull();
    });

    it("populates body and body_en on external add so search hits both columns", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 12);
      await writeNote(vaultPath, id, date, fm(), "externaladdbody");

      const fakeTranslator = async (text: string): Promise<string> => `english(${text})`;
      const result = await scanAndSync(db, vaultPath, fakeTranslator);
      expect(result.added).toBe(1);

      // body indexed from disk.
      expect(searchNotes(db, "externaladdbody").map((r) => r.id)).toEqual([id]);
      // body_en indexed via translator return value.
      expect(searchNotes(db, "english").map((r) => r.id)).toEqual([id]);
    });

    it("does NOT call the translator on UPDATE when the body is byte-identical", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 12);
      await writeNote(
        vaultPath,
        id,
        date,
        fm({ updatedAt: "2026-06-12T10:00:00+09:00" }),
        "stable body content"
      );
      await reindexAll(db, vaultPath, async () => "initialtranslation");
      expect(searchNotes(db, "initialtranslation").map((r) => r.id)).toEqual([id]);

      // Touch the file (frontmatter-only edit / explicit mtime bump) but
      // keep the body byte-identical.
      await writeNote(
        vaultPath,
        id,
        date,
        fm({ updatedAt: "2026-06-12T11:00:00+09:00", title: "TitleChangedOnly" }),
        "stable body content"
      );
      bumpMtime(buildNotePath(vaultPath, id, date));

      let translatorCalls = 0;
      const result = await scanAndSync(db, vaultPath, async () => {
        translatorCalls++;
        return "freshtranslation";
      });

      expect(result.updated).toBe(1);
      expect(translatorCalls).toBe(0);
      // body_en kept the original translation; no rewrite.
      expect(searchNotes(db, "initialtranslation").map((r) => r.id)).toEqual([id]);
      expect(searchNotes(db, "freshtranslation")).toEqual([]);
    });

    it("records a throwing translator on external add in translationErrors", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 12);
      await writeNote(vaultPath, id, date, fm(), "syncthrownbody");

      const result = await scanAndSync(db, vaultPath, async () => {
        throw new Error("sync pipeline failure");
      });

      expect(result.added).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.translationErrors).toHaveLength(1);
      // Row still landed; body searchable, body_en empty.
      expect(searchNotes(db, "syncthrownbody").map((r) => r.id)).toEqual([id]);
    });

    it("re-translates body_en when an external edit triggers UPDATE", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 12);
      await writeNote(
        vaultPath,
        id,
        date,
        fm({ updatedAt: "2026-06-12T10:00:00+09:00" }),
        "v1content"
      );

      // First pass: hydrate the row with a v1 translation.
      await reindexAll(db, vaultPath, async () => "v1translation");
      expect(searchNotes(db, "v1translation").map((r) => r.id)).toEqual([id]);

      // External edit: rewrite the file with new body + a translator that
      // returns a v2 translation, then bump mtime so sync detects change.
      await writeNote(
        vaultPath,
        id,
        date,
        fm({ updatedAt: "2026-06-12T15:00:00+09:00" }),
        "v2content"
      );
      bumpMtime(buildNotePath(vaultPath, id, date));

      const result = await scanAndSync(db, vaultPath, async () => "v2translation");
      expect(result.updated).toBe(1);

      // body reflects new content.
      expect(searchNotes(db, "v2content").map((r) => r.id)).toEqual([id]);
      // body_en reflects new translation; stale v1 translation is gone.
      expect(searchNotes(db, "v2translation").map((r) => r.id)).toEqual([id]);
      expect(searchNotes(db, "v1translation")).toEqual([]);
    });

    it("single file with invalid updatedAt yields one error and leaves DB unchanged", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 15);
      await writeNote(vaultPath, id, date, fm({ updatedAt: "not-a-date" }), "body");
      bumpMtime(buildNotePath(vaultPath, id, date));

      expect(notesCount(db)).toBe(0);

      const result = await scanAndSync(db, vaultPath);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(notesCount(db)).toBe(0);
    });
  });
});
