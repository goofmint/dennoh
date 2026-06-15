// Disable JA→EN translation: saveMemory / updateMemory schedule a background
// translation that would otherwise pull ~300MB of model weights on every run.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, historyCommand } from "@/cli";
import { writeConfig } from "@/config";
import { saveMemory, updateMemory } from "@/core/memory";
import { closeDatabase, openDatabase, runMigrations } from "@/db";

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

describe("cli history", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    // readConfig / writeConfig resolve the config path under os.homedir(); point
    // it at a throwaway dir so the test owns the config it reads back.
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-hist-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

    vaultPath = path.join(homeDir, "vault");
    fs.mkdirSync(vaultPath, { recursive: true });
    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });

    writeConfig({ vaultPath, lang: "ja" });

    // saveMemory writes into an existing schema, so migrate the DB once here.
    const db = openDatabase(vaultPath);
    runMigrations(db);
    closeDatabase(db);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("returns one entry per commit, newest first (T8.4)", async () => {
    // Three commits in the note's history: the initial add plus two updates.
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "v1\n");
    await updateMemory(db, vaultPath, id, "v2\n");
    await updateMemory(db, vaultPath, id, "v3\n");
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await historyCommand([id], io);

    expect(code).toBe(0);
    expect(stderr()).toBe("");

    const lines = stdout().trimEnd().split("\n");
    expect(lines).toHaveLength(3);

    // Each line: `<7-char sha> <ISO timestamp> <message>`, newest first.
    for (const line of lines) {
      expect(line).toMatch(/^[0-9a-f]{7} \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z .+$/);
    }
    const messages = lines.map((line) => line.split(" ").slice(2).join(" "));
    expect(messages).toEqual([`update ${id}`, `update ${id}`, `add ${id}`]);
  });

  it("errors for an unknown id", async () => {
    const { io, stdout, stderr } = makeIO();
    const code = await historyCommand(["018f0c8e-7c4f-7d3a-8b2e-000000000000"], io);

    expect(code).toBe(1);
    expect(stdout()).toBe("");
    expect(stderr()).toContain("not found");
  });

  it("errors when no id is given", async () => {
    const { io, stderr } = makeIO();
    const code = await historyCommand([], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("Usage");
  });
});
