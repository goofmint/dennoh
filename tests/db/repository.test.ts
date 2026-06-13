import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { NoteMetadata } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import { fromNoteRow, toNoteRow } from "@/db/mapper";
import { deleteNote, getAllNotes, getNoteById, insertNote, updateNote } from "@/db/repository";
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

function makeRow(overrides: Partial<NoteMetadata> = {}, body = "body text"): NoteRow {
  const meta = makeMetadata(overrides);
  return toNoteRow(meta, `/vault/2026/06/12/${meta.id}.md`, body);
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
      const row = toNoteRow(meta, "/vault/2026/06/12/x.md", "body");
      const { metadata, path: p } = fromNoteRow(row);
      expect(metadata).toEqual(meta);
      expect(p).toBe("/vault/2026/06/12/x.md");
    });

    it("fromNoteRow drops title when null", () => {
      const row = makeRow({ title: undefined });
      const { metadata } = fromNoteRow(row);
      expect(metadata.title).toBeUndefined();
    });
  });
});
