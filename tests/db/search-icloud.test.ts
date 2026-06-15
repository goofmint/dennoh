import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { NoteMetadata } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import { toNoteRow } from "@/db/mapper";
import { insertNote, searchNotes } from "@/db/repository";
import { runMigrations } from "@/db/schema";

// FTS5 indexing is path-agnostic, but the `path` column stores an absolute
// path that, on iCloud Drive, contains a space and a tilde. These tests feed
// `toNoteRow` exactly such a path and confirm it round-trips through insert →
// search → result.path unchanged, alongside the usual JA/EN search + filters.
const ICLOUD_VAULT = "/Users/me/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault";

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

// Build the same kind of absolute note path saveMemory would under an iCloud
// vault: <vault>/YYYY/MM/DD/<id>.md, space and tilde included.
function iCloudNotePath(id: string): string {
  return path.join(ICLOUD_VAULT, "2026", "06", "12", `${id}.md`);
}

function insertRow(
  db: Database,
  overrides: Partial<NoteMetadata>,
  body: string,
  bodyEn = ""
): { row: ReturnType<typeof toNoteRow>; notePath: string } {
  const meta = makeMetadata(overrides);
  const notePath = iCloudNotePath(meta.id);
  const row = toNoteRow(meta, notePath, body, bodyEn);
  insertNote(db, row);
  return { row, notePath };
}

describe("db/searchNotes (iCloud-style paths)", () => {
  let vaultPath: string;
  let db: Database;

  beforeEach(() => {
    // The on-disk SQLite file can live anywhere; the iCloud path under test is
    // the value stored in the `path` column, not the DB location.
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-search-icloud-"));
    db = openDatabase(vaultPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it("stores and returns an iCloud absolute path verbatim (space + tilde)", () => {
    const { notePath } = insertRow(db, { title: "PathRoundTrip" }, "pathroundtrip body");
    const results = searchNotes(db, "pathroundtrip");
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe(notePath);
    expect(results[0]?.path).toContain("Mobile Documents");
    expect(results[0]?.path).toContain("iCloud~md~obsidian");
  });

  it("matches Japanese full-text and English translation for a note on an iCloud path", () => {
    const { row } = insertRow(
      db,
      { title: "ProjectKickoff" },
      "プロジェクト。会議。記録",
      "Project kickoff meeting notes"
    );
    expect(searchNotes(db, "会議").map((r) => r.id)).toEqual([row.id]);
    expect(searchNotes(db, "kickoff").map((r) => r.id)).toEqual([row.id]);
  });

  it("applies project / tag filters on iCloud-path rows", () => {
    insertRow(db, { title: "A", projects: ["alpha"], tags: ["mcp"] }, "filterterm body");
    insertRow(db, { title: "B", projects: ["beta"], tags: ["other"] }, "filterterm body");

    expect(searchNotes(db, "filterterm", { project: "alpha" }).map((r) => r.title)).toEqual(["A"]);
    expect(searchNotes(db, "filterterm", { tag: "other" }).map((r) => r.title)).toEqual(["B"]);
  });

  it("applies a dateFrom/dateTo window on iCloud-path rows", () => {
    insertRow(db, { title: "Old", updatedAt: "2026-01-01T00:00:00+09:00" }, "windowed");
    insertRow(db, { title: "Mid", updatedAt: "2026-03-15T00:00:00+09:00" }, "windowed");
    insertRow(db, { title: "New", updatedAt: "2026-06-01T00:00:00+09:00" }, "windowed");

    const results = searchNotes(db, "windowed", {
      dateFrom: "2026-02-01T00:00:00+09:00",
      dateTo: "2026-05-01T00:00:00+09:00",
    });
    expect(results.map((r) => r.title)).toEqual(["Mid"]);
  });
});
