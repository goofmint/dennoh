// Disable JA→EN translation so saveMemory doesn't load model weights;
// see restore.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, deleteCommand } from "@/cli";
import { writeConfig } from "@/config";
import { saveMemory } from "@/core/memory";
import { closeDatabase, getNoteById, openDatabase, runMigrations } from "@/db";

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

describe("cli delete", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-delete-home-"));
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

  it("deletes the note, removes the file, and prints a confirmation", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "doomed\n");
    const filePath = getNoteById(db, id)?.path;
    if (filePath === undefined) throw new Error("note path missing after save");
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await deleteCommand([id], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");
    expect(stdout()).toContain(id);

    // File is gone and the row no longer resolves through the live filter.
    expect(fs.existsSync(filePath)).toBe(false);
    const db2 = openDatabase(vaultPath);
    const row = getNoteById(db2, id);
    closeDatabase(db2);
    expect(row).toBeNull();
  });

  it("errors for an unknown id", async () => {
    const { io, stderr } = makeIO();
    const code = await deleteCommand(["018f0c8e-7c4f-7d3a-8b2e-000000000000"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("見つか");
  });

  it("errors with usage when the id is missing", async () => {
    const { io, stderr } = makeIO();
    const code = await deleteCommand([], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("使い方");
  });

  it("errors when deleting an already-deleted id", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "doomed twice\n");
    closeDatabase(db);

    const { io: io1 } = makeIO();
    expect(await deleteCommand([id], io1)).toBe(0);

    const { io: io2, stderr } = makeIO();
    const code = await deleteCommand([id], io2);
    expect(code).toBe(1);
    expect(stderr()).toContain("見つか");
  });
});
