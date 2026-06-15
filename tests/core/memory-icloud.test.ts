import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { writeConfig } from "@/config";
import { readNote } from "@/core/file";
import { deleteMemory, getNote, listRecent, saveMemory, updateMemory } from "@/core/memory";
import { closeDatabase, openDatabase } from "@/db/connection";
import { getNoteById } from "@/db/repository";
import { runMigrations } from "@/db/schema";

// Same CRUD coverage as core/memory.test.ts, but the vault lives under an
// iCloud Drive-style path: it contains a space ("Mobile Documents") and a
// tilde ("iCloud~md~obsidian", Obsidian's container naming). The point is to
// prove that path-building, file I/O, git, and SQLite all survive those
// characters end-to-end — only the vaultPath construction differs from the
// base suite.
describe("core/memory (iCloud-style vault path)", () => {
  let homeDir: string;
  let baseDir: string;
  let vaultPath: string;
  let db: Database;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  let originalTranslateDisable: string | undefined;

  beforeEach(async () => {
    originalTranslateDisable = process.env.DENNOH_TRANSLATE_DISABLE;
    process.env.DENNOH_TRANSLATE_DISABLE = "1";

    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-icloud-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

    // <tmp>/.../Mobile Documents/iCloud~md~obsidian/Documents/MyVault
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-icloud-"));
    vaultPath = path.join(
      baseDir,
      "Mobile Documents",
      "iCloud~md~obsidian",
      "Documents",
      "MyVault"
    );
    fs.mkdirSync(vaultPath, { recursive: true });

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
    fs.rmSync(baseDir, { recursive: true, force: true });
    if (originalTranslateDisable === undefined) {
      Reflect.deleteProperty(process.env, "DENNOH_TRANSLATE_DISABLE");
    } else {
      process.env.DENNOH_TRANSLATE_DISABLE = originalTranslateDisable;
    }
  });

  it("saveMemory writes file/DB/git under the spaced, tilde'd vault path", async () => {
    const id = await saveMemory(db, vaultPath, "iCloud body #proj @tag");

    const row = getNoteById(db, id);
    if (row === null) {
      throw new Error("expected DB row for saved memory");
    }
    // The file lands inside the iCloud-style vault (space + tilde preserved).
    expect(row.path.startsWith(vaultPath)).toBe(true);
    expect(row.path).toContain("Mobile Documents");
    expect(row.path).toContain("iCloud~md~obsidian");
    expect(fs.existsSync(row.path)).toBe(true);
    expect(row.path).toMatch(/[/\\]\d{4}[/\\]\d{2}[/\\]\d{2}[/\\][0-9a-f-]{36}\.md$/);

    const onDisk = await readNote(row.path);
    expect(onDisk.body).toContain("iCloud body #proj @tag");
    expect(row.projects_json).toBe(JSON.stringify(["proj"]));
    expect(row.tags_json).toBe(JSON.stringify(["tag"]));

    const log = await git.log({ fs, dir: vaultPath });
    expect(log).toHaveLength(1);
    expect(log[0]?.commit.message.trim()).toBe(`add ${id}`);
  });

  it("updateMemory rewrites content and commits under the iCloud path", async () => {
    const id = await saveMemory(db, vaultPath, "v1 #old");
    await updateMemory(db, vaultPath, id, "v2 #new @reader");

    const row = getNoteById(db, id);
    if (row === null) {
      throw new Error("expected DB row after updateMemory");
    }
    expect(row.projects_json).toBe(JSON.stringify(["new"]));
    expect(row.tags_json).toBe(JSON.stringify(["reader"]));
    expect((await readNote(row.path)).body).toContain("v2 #new @reader");

    const log = await git.log({ fs, dir: vaultPath });
    expect(log.map((e) => e.commit.message.trim())).toEqual([`update ${id}`, `add ${id}`]);
  });

  it("getNote resolves an id back to its on-disk body", async () => {
    const id = await saveMemory(db, vaultPath, "lookup body #here");
    const note = await getNote(db, vaultPath, id);

    expect(note?.id).toBe(id);
    expect(note?.body).toContain("lookup body #here");
    expect(note?.frontmatter.projects).toEqual(["here"]);
  });

  it("listRecent returns saved notes newest-first", async () => {
    const a = await saveMemory(db, vaultPath, "first");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const b = await saveMemory(db, vaultPath, "second");

    expect(listRecent(db, 10).map((r) => r.id)).toEqual([b, a]);
  });

  it("deleteMemory removes the file and soft-deletes the row", async () => {
    const id = await saveMemory(db, vaultPath, "alive");
    const filePath = getNoteById(db, id)?.path;
    if (filePath === undefined) {
      throw new Error("expected DB row for newly-saved memory");
    }
    expect(fs.existsSync(filePath)).toBe(true);

    await deleteMemory(db, vaultPath, id);

    expect(fs.existsSync(filePath)).toBe(false);
    expect(getNoteById(db, id)).toBeNull();
    expect(await getNote(db, vaultPath, id)).toBeNull();

    const log = await git.log({ fs, dir: vaultPath });
    expect(log.map((e) => e.commit.message.trim())).toEqual([`delete ${id}`, `add ${id}`]);
  });
});
