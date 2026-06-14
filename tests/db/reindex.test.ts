// Reindex calls translateJaToEn for each note; disable the pipeline so the
// default test path doesn't trigger model downloads. Mocked-translator tests
// pass their own function via DI and don't depend on this flag.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

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
import { searchNotes } from "@/db/repository";
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
      const pairs = [
        [generateId(), new Date(2026, 5, 12)],
        [generateId(), new Date(2026, 5, 13)],
        [generateId(), new Date(2026, 5, 14)],
      ] as const;
      for (const [i, [idValue, dateValue]] of pairs.entries()) {
        await writeNote(vaultPath, idValue, dateValue, fm({ title: `t${i}` }), `body ${i}`);
      }

      // Fresh DB — no preexisting rows.
      expect(notesCount(db)).toBe(0);

      const result = await reindexAll(db, vaultPath);

      expect(result.processed).toBe(pairs.length);
      expect(result.errors).toEqual([]);
      expect(notesCount(db)).toBe(pairs.length);
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

    it("populates `body` so post-reindex search hits content from disk", async () => {
      const id = generateId();
      await writeNote(
        vaultPath,
        id,
        new Date(2026, 5, 12),
        fm({ title: "X" }),
        "ReindexedMarker phrase"
      );
      await reindexAll(db, vaultPath);

      const results = searchNotes(db, "ReindexedMarker");
      expect(results.map((r) => r.id)).toEqual([id]);
    });
  });

  describe("translator integration (DI)", () => {
    it("calls the injected translator once per processed note", async () => {
      const a = generateId();
      const b = generateId();
      await writeNote(vaultPath, a, new Date(2026, 5, 12), fm(), "alpha");
      await writeNote(vaultPath, b, new Date(2026, 5, 13), fm(), "beta");

      const calls: string[] = [];
      const mockTranslate = async (text: string): Promise<string> => {
        calls.push(text);
        return `EN(${text})`;
      };

      const result = await reindexAll(db, vaultPath, mockTranslate);
      expect(result.processed).toBe(2);
      expect(calls.sort()).toEqual(["alpha", "beta"]);

      // body_en is queryable through FTS, proving the mock value flowed
      // through toNoteRow → insertNote → notes_fts.
      const aResults = searchNotes(db, "alpha");
      expect(aResults[0]?.id).toBe(a);
      const enResults = searchNotes(db, "EN");
      expect(enResults.map((r) => r.id).sort()).toEqual([a, b].sort());
    });

    it("retranslates an existing row whose body_en was empty (legacy / offline)", async () => {
      const id = generateId();
      await writeNote(vaultPath, id, new Date(2026, 5, 12), fm(), "originalbody");

      // First pass: simulate the offline / disabled translator producing "".
      await reindexAll(db, vaultPath, async () => "");
      expect(searchNotes(db, "fixedtranslation")).toEqual([]);

      // Second pass: simulate the operator coming back online; the new
      // translator now returns content. body_en should be repopulated.
      await reindexAll(db, vaultPath, async () => "fixedtranslation");
      expect(searchNotes(db, "fixedtranslation").map((r) => r.id)).toEqual([id]);
    });

    it("gracefully degrades to body_en='' when the translator returns '' (simulated offline)", async () => {
      const id = generateId();
      await writeNote(vaultPath, id, new Date(2026, 5, 12), fm(), "offlinebody");

      const result = await reindexAll(db, vaultPath, async () => "");
      expect(result.errors).toEqual([]);
      // A translator that absorbs to "" is NOT a thrown failure, so the
      // separate translationErrors bucket stays empty too.
      expect(result.translationErrors).toEqual([]);
      expect(result.processed).toBe(1);

      // body remains searchable (the note still landed)…
      expect(searchNotes(db, "offlinebody").map((r) => r.id)).toEqual([id]);
      // …but body_en stays empty so an arbitrary English term does not match.
      expect(searchNotes(db, "anyenglishterm")).toEqual([]);
    });

    it("records a throwing translator in translationErrors and still inserts the row", async () => {
      const id = generateId();
      await writeNote(vaultPath, id, new Date(2026, 5, 12), fm(), "thrownbody");

      const result = await reindexAll(db, vaultPath, async () => {
        throw new Error("simulated pipeline failure");
      });

      expect(result.processed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.translationErrors).toHaveLength(1);
      expect(result.translationErrors[0]?.message).toMatch(/simulated pipeline failure/);

      // The row still landed with body searchable, body_en empty.
      expect(searchNotes(db, "thrownbody").map((r) => r.id)).toEqual([id]);
    });
  });
});
