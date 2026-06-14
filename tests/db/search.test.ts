import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { NoteMetadata } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import { toNoteRow } from "@/db/mapper";
import { insertNote, searchNotes, softDeleteNote } from "@/db/repository";
import { runMigrations } from "@/db/schema";
import type { NoteRow } from "@/db/types";

function makeMetadata(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: generateId(),
    createdAt: "2026-06-12T10:00:00+09:00",
    updatedAt: "2026-06-12T10:05:00+09:00",
    source: "note",
    title: "Untitled",
    projects: [],
    tags: [],
    ...overrides,
  };
}

function insertRow(
  db: Database,
  overrides: Partial<NoteMetadata>,
  body: string,
  bodyEn = ""
): NoteRow {
  const meta = makeMetadata(overrides);
  const row = toNoteRow(meta, `/vault/2026/06/12/${meta.id}.md`, body, bodyEn);
  insertNote(db, row);
  return row;
}

describe("db/searchNotes", () => {
  let vaultPath: string;
  let db: Database;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-search-"));
    db = openDatabase(vaultPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("FTS MATCH (title / body / body_en)", () => {
    it("matches a term that appears only in title", () => {
      const row = insertRow(db, { title: "AlphaTitleMatch" }, "irrelevant body");
      const results = searchNotes(db, "AlphaTitleMatch");
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(row.id);
    });

    it("matches a Japanese token bounded by non-letter chars in body", () => {
      // unicode61 treats CJK chars as letters, so runs of contiguous kanji /
      // kana collapse into a single token. The query term has to align with
      // the token boundary; here `日記` is wrapped in punctuation so it is
      // its own token. Sub-token search in continuous Japanese is a known
      // limitation of `unicode61 remove_diacritics 0` and would require a
      // tokenizer change (e.g., trigram) to fix.
      const row = insertRow(db, { title: "untitled" }, "メモ。日記。memo");
      const results = searchNotes(db, "日記");
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(row.id);
    });

    it("does NOT match a sub-token query inside a continuous Japanese run", () => {
      // Documenting the limitation: `日記` does not match `今日の日記とメモ`
      // because the whole run is one unicode61 token.
      insertRow(db, { title: "untitled" }, "今日の日記とメモ");
      expect(searchNotes(db, "日記")).toEqual([]);
    });

    it("matches a term that appears only in body_en (English translation)", () => {
      const row = insertRow(db, { title: "untitled" }, "日本語の本文", "The English translation");
      const results = searchNotes(db, "English");
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(row.id);
    });

    it("returns nothing when the query does not appear in any column", () => {
      insertRow(db, { title: "alpha" }, "beta gamma");
      expect(searchNotes(db, "ZZZmissingterm")).toEqual([]);
    });
  });

  describe("snippet output", () => {
    it("returns a snippet string for a body match", () => {
      insertRow(db, { title: "T" }, "before SnippetMarker after content");
      const results = searchNotes(db, "SnippetMarker");
      expect(results).toHaveLength(1);
      expect(results[0]?.snippet).toContain("<mark>SnippetMarker</mark>");
    });
  });

  describe("result shape", () => {
    it("parses projects_json / tags_json back into string arrays", () => {
      insertRow(
        db,
        { title: "Shape", projects: ["alpha", "beta"], tags: ["x", "y"] },
        "shape body"
      );
      const results = searchNotes(db, "shape");
      expect(results).toHaveLength(1);
      expect(results[0]?.projects).toEqual(["alpha", "beta"]);
      expect(results[0]?.tags).toEqual(["x", "y"]);
    });

    it("returns the path / source / timestamps from the notes row", () => {
      const meta = makeMetadata({
        title: "TimestampedTitle",
        createdAt: "2026-05-01T00:00:00+09:00",
        updatedAt: "2026-05-02T00:00:00+09:00",
      });
      const row = toNoteRow(meta, `/vault/2026/05/01/${meta.id}.md`, "TimestampedTitle body", "");
      insertNote(db, row);

      const results = searchNotes(db, "TimestampedTitle");
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe(`/vault/2026/05/01/${meta.id}.md`);
      expect(results[0]?.source).toBe("note");
      expect(results[0]?.createdAt).toBe("2026-05-01T00:00:00+09:00");
      expect(results[0]?.updatedAt).toBe("2026-05-02T00:00:00+09:00");
    });
  });

  describe("filters", () => {
    it("project filter narrows to rows whose projects_json contains the value", () => {
      insertRow(db, { title: "A", projects: ["alpha"] }, "common term");
      insertRow(db, { title: "B", projects: ["beta"] }, "common term");
      const results = searchNotes(db, "common", { project: "beta" });
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe("B");
    });

    it("project filter escapes LIKE wildcards so `foo_bar` does not match `fooXbar`", () => {
      insertRow(db, { title: "A", projects: ["foo_bar"] }, "common term");
      insertRow(db, { title: "B", projects: ["fooXbar"] }, "common term");
      const results = searchNotes(db, "common", { project: "foo_bar" });
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe("A");
    });

    it("tag filter narrows to rows whose tags_json contains the value", () => {
      insertRow(db, { title: "A", tags: ["mcp"] }, "tagged term");
      insertRow(db, { title: "B", tags: ["other"] }, "tagged term");
      const results = searchNotes(db, "tagged", { tag: "mcp" });
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe("A");
    });

    it("dateFrom / dateTo restrict the updated_at window (inclusive)", () => {
      insertRow(db, { title: "Old", updatedAt: "2026-01-01T00:00:00+09:00" }, "windowed");
      insertRow(db, { title: "Mid", updatedAt: "2026-03-15T00:00:00+09:00" }, "windowed");
      insertRow(db, { title: "New", updatedAt: "2026-06-01T00:00:00+09:00" }, "windowed");

      const results = searchNotes(db, "windowed", {
        dateFrom: "2026-02-01T00:00:00+09:00",
        dateTo: "2026-05-01T00:00:00+09:00",
      });
      expect(results.map((r) => r.title)).toEqual(["Mid"]);
    });

    it("source filter accepts the configured NoteSource values", () => {
      insertRow(db, { title: "S", source: "note" }, "sourced");
      const results = searchNotes(db, "sourced", { source: "note" });
      expect(results).toHaveLength(1);
    });
  });

  describe("soft-delete exclusion", () => {
    // FTS5 uses `-` as the NOT operator, so the test keyword stays
    // hyphen-free to keep the MATCH query unambiguous.
    it("hides soft-deleted rows from search results", () => {
      const row = insertRow(db, { title: "T" }, "softdeletable body");
      softDeleteNote(db, row.id);
      expect(searchNotes(db, "softdeletable")).toEqual([]);
    });
  });

  describe("bilingual / cross-language", () => {
    // Same note carries both Japanese source (`body`) and an English
    // translation (`body_en`). Cross-language recall means a query in
    // either language returns the same row, exercising the dual indexing
    // that motivates the body_en column.
    it("the same row is recalled by both a Japanese-only query and an English-only query", () => {
      const row = insertRow(
        db,
        { title: "ProjectKickoff" },
        "プロジェクト。会議。記録",
        "Project kickoff meeting notes"
      );

      const jaResults = searchNotes(db, "会議");
      const enResults = searchNotes(db, "kickoff");

      expect(jaResults.map((r) => r.id)).toEqual([row.id]);
      expect(enResults.map((r) => r.id)).toEqual([row.id]);
    });

    it("a token like `FTS` is matched when the body separates it from kana with whitespace", () => {
      // unicode61 splits on whitespace and punctuation, so `FTS テスト`
      // becomes two tokens: ["fts", "テスト"]. The query `FTS` then matches.
      // This is the realistic shape of mixed-language notes in the vault.
      const row = insertRow(db, { title: "T" }, "本文 FTS テスト for indexing");
      const results = searchNotes(db, "FTS");
      expect(results.map((r) => r.id)).toEqual([row.id]);
    });

    it("rejects an empty FTS query string", () => {
      insertRow(db, { title: "AnyRow" }, "any body");
      // FTS5 MATCH with an empty string throws a parse error at the SQLite
      // layer; surfacing it lets callers distinguish "no results" (empty
      // array) from "malformed query" (exception). We do not want a
      // silently-empty array here because that would mask a UI bug.
      expect(() => searchNotes(db, "")).toThrow();
    });
  });

  describe("limit", () => {
    it("respects the limit argument", () => {
      for (let i = 0; i < 5; i++) {
        insertRow(db, { title: `t${i}` }, "limittarget body");
      }
      const results = searchNotes(db, "limittarget", undefined, 2);
      expect(results).toHaveLength(2);
    });

    it("defaults to 20 when limit is omitted", () => {
      for (let i = 0; i < 25; i++) {
        insertRow(db, { title: `t${i}` }, "defaultlimittarget body");
      }
      const results = searchNotes(db, "defaultlimittarget");
      expect(results).toHaveLength(20);
    });

    it("rejects non-positive-integer limits", () => {
      expect(() => searchNotes(db, "x", undefined, 0)).toThrow(/positive integer/);
      expect(() => searchNotes(db, "x", undefined, -1)).toThrow(/positive integer/);
      expect(() => searchNotes(db, "x", undefined, 1.5)).toThrow(/positive integer/);
    });
  });
});
