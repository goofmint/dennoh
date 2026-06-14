import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import git from "isomorphic-git";

import { writeConfig } from "@/config";
import { readNote } from "@/core/file";
import { deleteMemory, getNote, listRecent, saveMemory, updateMemory } from "@/core/memory";
import { ContentValidationError } from "@/core/validate";
import { closeDatabase, openDatabase } from "@/db/connection";
import { getNoteById } from "@/db/repository";
import { runMigrations } from "@/db/schema";

describe("core/memory", () => {
  let homeDir: string;
  let vaultPath: string;
  let db: Database;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-memory-home-"));
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-memory-vault-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

    writeConfig({ vaultPath, lang: "ja", maxFileSizeBytes: 1_048_576 });

    db = openDatabase(vaultPath);
    runMigrations(db);

    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });
  });

  afterEach(() => {
    closeDatabase(db);
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("saveMemory", () => {
    it("writes the file, inserts the row, and creates an 'add <id>' commit", async () => {
      const id = await saveMemory(db, vaultPath, "Hello #project @tag");

      const row = getNoteById(db, id);
      if (row === null) {
        throw new Error("expected DB row for saved memory");
      }
      expect(row.id).toBe(id);
      expect(row.projects_json).toBe(JSON.stringify(["project"]));
      expect(row.tags_json).toBe(JSON.stringify(["tag"]));
      expect(row.source).toBe("note");

      // File lives under <vault>/YYYY/MM/DD/<id>.md.
      const filePath = row.path;
      expect(filePath.startsWith(vaultPath)).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toMatch(/[/\\]\d{4}[/\\]\d{2}[/\\]\d{2}[/\\][0-9a-f-]{36}\.md$/);

      // On-disk frontmatter matches the DB row across every field the row
      // stores (timestamps, source, projects, tags).
      const onDisk = await readNote(filePath);
      expect(onDisk.body).toContain("Hello #project @tag");
      expect(onDisk.frontmatter.createdAt).toBe(row.created_at);
      expect(onDisk.frontmatter.updatedAt).toBe(row.updated_at);
      expect(onDisk.frontmatter.source).toBe(row.source);
      expect(onDisk.frontmatter.projects).toEqual(JSON.parse(row.projects_json));
      expect(onDisk.frontmatter.tags).toEqual(JSON.parse(row.tags_json));

      const log = await git.log({ fs, dir: vaultPath });
      expect(log).toHaveLength(1);
      expect(log[0]?.commit.message.trim()).toBe(`add ${id}`);
    });

    it("uses 'note' as the default source when none is passed", async () => {
      const id = await saveMemory(db, vaultPath, "default-source test");
      expect(getNoteById(db, id)?.source).toBe("note");
    });

    it("rejects content over the configured size cap", async () => {
      writeConfig({ vaultPath, lang: "ja", maxFileSizeBytes: 16 });
      await expect(saveMemory(db, vaultPath, "a".repeat(100))).rejects.toBeInstanceOf(
        ContentValidationError
      );
    });

    it("rejects content containing a NULL byte", async () => {
      await expect(saveMemory(db, vaultPath, "good\0bad")).rejects.toBeInstanceOf(
        ContentValidationError
      );
    });
  });

  describe("updateMemory", () => {
    it("bumps updatedAt, preserves createdAt, re-extracts mentions, and commits 'update <id>'", async () => {
      const id = await saveMemory(db, vaultPath, "v1 body #old");
      const beforeRow = getNoteById(db, id);
      const beforeCreatedAt = beforeRow?.created_at;
      const beforeUpdatedAt = beforeRow?.updated_at;
      expect(beforeRow?.projects_json).toBe(JSON.stringify(["old"]));

      // Ensure updatedAt advances at least one second.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await updateMemory(db, vaultPath, id, "v2 body #new @reader");
      const afterRow = getNoteById(db, id);
      if (afterRow === null) {
        throw new Error("expected DB row after updateMemory");
      }

      expect(afterRow.created_at).toBe(beforeCreatedAt ?? "");
      expect(afterRow.updated_at).not.toBe(beforeUpdatedAt);
      expect(afterRow.projects_json).toBe(JSON.stringify(["new"]));
      expect(afterRow.tags_json).toBe(JSON.stringify(["reader"]));

      const onDisk = await readNote(afterRow.path);
      expect(onDisk.body).toContain("v2 body #new @reader");

      const log = await git.log({ fs, dir: vaultPath });
      expect(log.map((e) => e.commit.message.trim())).toEqual([`update ${id}`, `add ${id}`]);
    });

    it("throws when the id is unknown", async () => {
      await expect(updateMemory(db, vaultPath, "no-such-id", "x")).rejects.toThrow(
        /not found or already deleted/
      );
    });

    it("throws on a soft-deleted note (live filter is enforced by getNoteById)", async () => {
      const id = await saveMemory(db, vaultPath, "to be deleted");
      await deleteMemory(db, vaultPath, id);
      await expect(updateMemory(db, vaultPath, id, "ressurect?")).rejects.toThrow(
        /not found or already deleted/
      );
    });

    it("rejects oversized new content before touching disk or DB", async () => {
      const id = await saveMemory(db, vaultPath, "small");
      writeConfig({ vaultPath, lang: "ja", maxFileSizeBytes: 16 });

      await expect(updateMemory(db, vaultPath, id, "a".repeat(100))).rejects.toBeInstanceOf(
        ContentValidationError
      );

      // File and DB are untouched by the rejected update.
      const row = getNoteById(db, id);
      if (row === null) {
        throw new Error("expected DB row to survive a rejected updateMemory");
      }
      const onDisk = await readNote(row.path);
      expect(onDisk.body).toContain("small");
    });

    it("rejects content containing a NULL byte", async () => {
      const id = await saveMemory(db, vaultPath, "before");
      await expect(updateMemory(db, vaultPath, id, "bad\0content")).rejects.toBeInstanceOf(
        ContentValidationError
      );

      // Original content survives.
      const row = getNoteById(db, id);
      if (row === null) {
        throw new Error("expected DB row to survive a rejected updateMemory");
      }
      const onDisk = await readNote(row.path);
      expect(onDisk.body).toContain("before");
    });
  });

  describe("deleteMemory", () => {
    it("removes the file, soft-deletes the row, and commits 'delete <id>'", async () => {
      const id = await saveMemory(db, vaultPath, "alive");
      const row = getNoteById(db, id);
      if (row === null) {
        throw new Error("expected DB row for newly-saved memory");
      }
      const filePath = row.path;
      expect(fs.existsSync(filePath)).toBe(true);

      await deleteMemory(db, vaultPath, id);

      expect(fs.existsSync(filePath)).toBe(false);
      expect(getNoteById(db, id)).toBeNull();
      // Public read API also returns null — the live filter survives the
      // additional disk-read step in getNote.
      expect(await getNote(db, vaultPath, id)).toBeNull();

      // Soft-deleted row still physically present.
      const tombstone = db
        .query<{ id: string; deleted_at: string | null }, [string]>(
          "SELECT id, deleted_at FROM notes WHERE id = ?"
        )
        .get(id);
      expect(tombstone?.id).toBe(id);
      expect(tombstone?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const log = await git.log({ fs, dir: vaultPath });
      expect(log.map((e) => e.commit.message.trim())).toEqual([`delete ${id}`, `add ${id}`]);
    });

    it("throws when the id is unknown", async () => {
      await expect(deleteMemory(db, vaultPath, "no-such-id")).rejects.toThrow(
        /not found or already deleted/
      );
    });

    it("throws on a double delete", async () => {
      const id = await saveMemory(db, vaultPath, "once");
      await deleteMemory(db, vaultPath, id);
      await expect(deleteMemory(db, vaultPath, id)).rejects.toThrow(/not found or already deleted/);
    });
  });

  describe("getNote", () => {
    it("resolves each id back to its own body when multiple notes coexist", async () => {
      const idA = await saveMemory(db, vaultPath, "alpha body");
      const idB = await saveMemory(db, vaultPath, "beta body #beta-proj");
      const idC = await saveMemory(db, vaultPath, "gamma body @gamma-tag");

      const a = await getNote(db, vaultPath, idA);
      const b = await getNote(db, vaultPath, idB);
      const c = await getNote(db, vaultPath, idC);

      expect(a?.body).toContain("alpha body");
      expect(b?.body).toContain("beta body");
      expect(b?.frontmatter.projects).toEqual(["beta-proj"]);
      expect(c?.body).toContain("gamma body");
      expect(c?.frontmatter.tags).toEqual(["gamma-tag"]);
    });

    it("returns id + frontmatter + body for a live note", async () => {
      const id = await saveMemory(db, vaultPath, "lookup body #proj");
      const note = await getNote(db, vaultPath, id);

      expect(note).not.toBeNull();
      expect(note?.id).toBe(id);
      expect(note?.body).toContain("lookup body #proj");
      expect(note?.frontmatter.projects).toEqual(["proj"]);
    });

    it("returns null for an unknown id", async () => {
      expect(await getNote(db, vaultPath, "no-such-id")).toBeNull();
    });

    it("returns null for a soft-deleted note", async () => {
      const id = await saveMemory(db, vaultPath, "soon to be gone");
      await deleteMemory(db, vaultPath, id);
      expect(await getNote(db, vaultPath, id)).toBeNull();
    });
  });

  describe("listRecent", () => {
    it("returns the latest `limit` rows in updated_at DESC order", async () => {
      const a = await saveMemory(db, vaultPath, "first");
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const b = await saveMemory(db, vaultPath, "second");
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const c = await saveMemory(db, vaultPath, "third");
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const d = await saveMemory(db, vaultPath, "fourth");

      const rows = listRecent(db, 3);
      expect(rows.map((r) => r.id)).toEqual([d, c, b]);
      expect(rows.every((r) => r.id !== a)).toBe(true);
    });

    it("defaults to a limit of 10", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) {
        ids.push(await saveMemory(db, vaultPath, `body ${i}`));
      }
      expect(listRecent(db).length).toBe(10);
    });

    it("excludes soft-deleted notes from the result", async () => {
      const keep = await saveMemory(db, vaultPath, "keep");
      const drop = await saveMemory(db, vaultPath, "drop");
      await deleteMemory(db, vaultPath, drop);

      const rows = listRecent(db);
      expect(rows.map((r) => r.id)).toEqual([keep]);
    });
  });
});
