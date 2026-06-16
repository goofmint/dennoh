// Disable JA→EN translation so saveMemory / reindexAll don't load model
// weights; see restore.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, reindexCommand } from "@/cli";
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

describe("cli reindex", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-reindex-home-"));
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

  it("rebuilds the index and reports the processed count", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "indexed note\n");
    // Wipe the row so reindex has something to restore from disk.
    db.exec("DELETE FROM notes;");
    expect(getNoteById(db, id)).toBeNull();
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await reindexCommand([], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");
    // Japanese summary under the default lang:ja config: "1 件のメモを
    // 再インデックスしました。エラー 0 件、翻訳エラー 0 件"
    expect(stdout()).toContain("1 件のメモを再インデックスしました");
    expect(stdout()).toContain("エラー 0 件");
    expect(stdout()).toContain("翻訳エラー 0 件");

    // The note is back in the index after the rebuild.
    const db2 = openDatabase(vaultPath);
    expect(getNoteById(db2, id)?.body).toBe("indexed note\n");
    closeDatabase(db2);
  });

  it("errors on unexpected arguments", async () => {
    const { io, stderr } = makeIO();
    const code = await reindexCommand(["--json"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("予期しない");
  });
});
