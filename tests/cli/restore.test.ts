// Disable JA→EN translation so saveMemory / updateMemory don't load model
// weights; see history.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, restoreCommand } from "@/cli";
import { writeConfig } from "@/config";
import { parseFrontmatter } from "@/core/frontmatter";
import { saveMemory, updateMemory } from "@/core/memory";
import { closeDatabase, getNoteById, openDatabase, runMigrations } from "@/db";
import { gitLog } from "@/git";

function makeIO(): { io: CliIO; stdout: () => string; stderr: () => string } {
  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  return {
    io: {
      stdout: (s) => {
        stdoutBuf.push(s);
      },
      stderr: (s) => {
        stderrBuf.push(s);
      },
    },
    stdout: () => stdoutBuf.join(""),
    stderr: () => stderrBuf.join(""),
  };
}

describe("cli restore", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-restore-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

    vaultPath = path.join(homeDir, "vault");
    fs.mkdirSync(vaultPath, { recursive: true });
    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });

    writeConfig({ vaultPath, lang: "ja" });

    const db = openDatabase(vaultPath);
    runMigrations(db);
    closeDatabase(db);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("restores the file to the chosen commit and records a new commit (T8.5)", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "first version\n");
    const filePath = getNoteById(db, id)?.path;
    if (filePath === undefined) throw new Error("note path missing after save");
    await updateMemory(db, vaultPath, id, "second version\n");

    // Oldest commit (the `add`) holds the first version. gitLog is newest-first.
    const before = await gitLog(vaultPath, filePath);
    const addSha = before[before.length - 1]?.sha;
    if (addSha === undefined) throw new Error("add commit not found");
    closeDatabase(db);

    const { io, stderr } = makeIO();
    const code = await restoreCommand([id, addSha], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");

    // File content now matches the first version's body.
    const restored = fs.readFileSync(filePath, "utf-8");
    expect(parseFrontmatter(restored).body).toBe("first version\n");

    // A new commit was appended on top of the two existing ones.
    const after = await gitLog(vaultPath, filePath);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]?.message).toBe(`update ${id}`);

    // DB row reflects the restore: body re-indexed, body_en reset to "".
    const db2 = openDatabase(vaultPath);
    const row = getNoteById(db2, id);
    closeDatabase(db2);
    expect(row?.body).toBe("first version\n");
    expect(row?.body_en).toBe("");
  });

  it("accepts the 7-char short SHA that `history` prints", async () => {
    // history outputs abbreviated SHAs; restore must round-trip them. isomorphic-git
    // does not expand short oids implicitly, so gitShow runs expandOid first —
    // this guards that integration.
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "first version\n");
    const filePath = getNoteById(db, id)?.path;
    if (filePath === undefined) throw new Error("note path missing after save");
    await updateMemory(db, vaultPath, id, "second version\n");

    const before = await gitLog(vaultPath, filePath);
    const addSha = before[before.length - 1]?.sha;
    if (addSha === undefined) throw new Error("add commit not found");
    closeDatabase(db);

    const { io, stderr } = makeIO();
    const code = await restoreCommand([id, addSha.slice(0, 7)], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");
    expect(parseFrontmatter(fs.readFileSync(filePath, "utf-8")).body).toBe("first version\n");
  });

  it("errors for an unknown id", async () => {
    const { io, stderr } = makeIO();
    const code = await restoreCommand(["018f0c8e-7c4f-7d3a-8b2e-000000000000", "0".repeat(40)], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("not found");
  });

  it("errors for an invalid commit SHA on an existing note", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "content\n");
    closeDatabase(db);

    const { io, stderr } = makeIO();
    const code = await restoreCommand([id, "0".repeat(40)], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("does not exist");
  });

  it("errors when arguments are missing", async () => {
    const { io, stderr } = makeIO();
    const code = await restoreCommand(["only-id"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("Usage");
  });
});
