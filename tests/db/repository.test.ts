import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { NoteMetadata } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import { fromNoteRow, toNoteRow } from "@/db/mapper";
import {
  deleteNote,
  getAllNotes,
  getNoteById,
  insertNote,
  softDeleteNote,
  updateNote,
} from "@/db/repository";
import { runMigrations } from "@/db/schema";
import type { NoteRow } from "@/db/types";

function makeMetadata(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: generateId(),
    createdAt: "2026-06-12T10:30:00+09:00",
    updatedAt: "2026-06-12T10:35:00+09:00",
    source: "note",
    title: "Original Title",
    projects: ["denno"],
    tags: ["mcp"],
    ...overrides,
  };
}

function makeRow(overrides: Partial<NoteMetadata> = {}, body = "body text", bodyEn = ""): NoteRow {
  const meta = makeMetadata(overrides);
  return toNoteRow(meta, `/vault/2026/06/12/${meta.id}.md`, body, bodyEn);
}

function ftsCountByTitle(db: Database, term: string): number {
  const row = db
    .query<{ c: number }, [string]>("SELECT COUNT(*) AS c FROM notes_fts WHERE title MATCH ?")
    .get(term);
  return row?.c ?? 0;
}

function notesCount(db: Database): number {
  const row = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM notes").get();
  return row?.c ?? 0;
}

function ftsCount(db: Database): number {
  const row = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM notes_fts").get();
  return row?.c ?? 0;
}

describe("db/repository", () => {
  let vaultPath: string;
  let db: Database;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-repo-"));
    db = openDatabase(vaultPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("insertNote", () => {
    it("writes a row that getNoteById can read back unchanged", () => {
      const row = makeRow({ title: "Hello" });
      insertNote(db, row);

      const fetched = getNoteById(db, row.id);
      expect(fetched).toEqual(row);
    });

    it("propagates the row through the FTS sync trigger", () => {
      const row = makeRow({ title: "InsertSyncTitle" });
      insertNote(db, row);

      expect(notesCount(db)).toBe(1);
      expect(ftsCount(db)).toBe(1);
      expect(ftsCountByTitle(db, "InsertSyncTitle")).toBe(1);
    });
  });

  describe("updateNote", () => {
    it("updates updated_at and re-syncs FTS with the new title", () => {
      const initial = makeRow({ title: "BeforeUpdate" });
      insertNote(db, initial);

      const updated: NoteRow = {
        ...initial,
        title: "AfterUpdate",
        updated_at: "2026-06-12T11:00:00+09:00",
      };
      updateNote(db, updated);

      const fetched = getNoteById(db, initial.id);
      expect(fetched?.updated_at).toBe("2026-06-12T11:00:00+09:00");
      expect(fetched?.title).toBe("AfterUpdate");

      expect(ftsCountByTitle(db, "BeforeUpdate")).toBe(0);
      expect(ftsCountByTitle(db, "AfterUpdate")).toBe(1);
    });

    it("throws when the target row does not exist", () => {
      const ghost = makeRow();
      expect(() => updateNote(db, ghost)).toThrow(/no row found/);
    });
  });

  describe("deleteNote", () => {
    it("removes the row from both notes and notes_fts", () => {
      const row = makeRow({ title: "ToBeDeleted" });
      insertNote(db, row);
      expect(notesCount(db)).toBe(1);
      expect(ftsCount(db)).toBe(1);

      deleteNote(db, row.id);

      expect(notesCount(db)).toBe(0);
      expect(ftsCount(db)).toBe(0);
      expect(getNoteById(db, row.id)).toBeNull();
    });
  });

  describe("CRUD consistency (T4.4 acceptance)", () => {
    it("keeps notes and notes_fts in lockstep across insert → update → delete", () => {
      const a = makeRow({ title: "AlphaTitle" });
      const b = makeRow({ title: "BetaTitle" });

      insertNote(db, a);
      insertNote(db, b);
      expect(notesCount(db)).toBe(2);
      expect(ftsCount(db)).toBe(2);

      updateNote(db, { ...a, title: "AlphaRenamed", updated_at: "2026-06-12T12:00:00+09:00" });
      expect(ftsCountByTitle(db, "AlphaTitle")).toBe(0);
      expect(ftsCountByTitle(db, "AlphaRenamed")).toBe(1);
      expect(ftsCountByTitle(db, "BetaTitle")).toBe(1);

      deleteNote(db, b.id);
      expect(notesCount(db)).toBe(1);
      expect(ftsCount(db)).toBe(1);
      expect(ftsCountByTitle(db, "BetaTitle")).toBe(0);
    });
  });

  describe("getAllNotes", () => {
    it("returns rows ordered by updated_at DESC", () => {
      const older = makeRow({ updatedAt: "2026-06-10T00:00:00+09:00" });
      const newer = makeRow({ updatedAt: "2026-06-15T00:00:00+09:00" });
      insertNote(db, older);
      insertNote(db, newer);

      const rows = getAllNotes(db);
      expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
    });
  });

  describe("mapper round-trip", () => {
    it("toNoteRow → fromNoteRow preserves metadata", () => {
      const meta = makeMetadata({
        title: "Round-trip",
        projects: ["a", "b"],
        tags: ["x", "y"],
      });
      const row = toNoteRow(meta, "/vault/2026/06/12/x.md", "body", "english body");
      const { metadata, path: p, body, body_en } = fromNoteRow(row);
      expect(metadata).toEqual(meta);
      expect(body).toBe("body");
      expect(body_en).toBe("english body");
      expect(p).toBe("/vault/2026/06/12/x.md");
    });

    it("fromNoteRow drops title when null", () => {
      const row = makeRow({ title: undefined });
      const { metadata } = fromNoteRow(row);
      expect(metadata.title).toBeUndefined();
    });
  });

  describe("softDeleteNote", () => {
    it("hides the note from getNoteById and getAllNotes but keeps the row physically", () => {
      const a = makeRow({ title: "Keep" });
      const b = makeRow({ title: "ToBeSoftDeleted" });
      insertNote(db, a);
      insertNote(db, b);

      softDeleteNote(db, b.id);

      expect(getNoteById(db, b.id)).toBeNull();
      expect(getAllNotes(db).map((r) => r.id)).toEqual([a.id]);

      // Live row still on disk — count includes the tombstone.
      const total = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM notes").get();
      expect(total?.c).toBe(2);

      // deleted_at was stamped with an ISO 8601 timestamp.
      const stamped = db
        .query<{ deleted_at: string | null }, [string]>("SELECT deleted_at FROM notes WHERE id = ?")
        .get(b.id);
      expect(stamped?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("throws when the target id is missing or already soft-deleted", () => {
      const row = makeRow();
      insertNote(db, row);
      softDeleteNote(db, row.id);

      expect(() => softDeleteNote(db, row.id)).toThrow(/no live row found/);
      expect(() => softDeleteNote(db, "nonexistent-id")).toThrow(/no live row found/);
    });

    it("hard deleteNote still removes a soft-deleted row entirely", () => {
      const row = makeRow();
      insertNote(db, row);
      softDeleteNote(db, row.id);

      deleteNote(db, row.id);

      const total = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM notes").get();
      expect(total?.c).toBe(0);
    });

    it("removes the row from notes_fts so FTS MATCH cannot surface it", () => {
      // The AFTER UPDATE trigger guards re-insertion on `new.deleted_at IS
      // NULL`. Without that guard, soft-delete would leave the row in
      // notes_fts and only the JOIN filter on `searchNotes` would hide it
      // — wasteful in FTS storage and broken for any future raw FTS query.
      //
      // We assert via MATCH count because external-content FTS5's
      // `SELECT COUNT(*) FROM notes_fts` proxies through the content
      // table (`notes`), so it still counts the soft-delete tombstone row
      // even after the FTS index has been emptied. The MATCH-based query
      // exercises the index itself.
      const row = makeRow({ title: "FtsSoftDeleteTarget" });
      insertNote(db, row);
      expect(ftsCountByTitle(db, "FtsSoftDeleteTarget")).toBe(1);

      softDeleteNote(db, row.id);
      expect(ftsCountByTitle(db, "FtsSoftDeleteTarget")).toBe(0);
    });
  });
});
