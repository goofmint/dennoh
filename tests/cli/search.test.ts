// Disable JA→EN translation so saveMemory doesn't load model weights;
// see restore.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, searchCommand } from "@/cli";
import { writeConfig } from "@/config";
import { saveMemory } from "@/core/memory";
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

describe("cli search", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-search-home-"));
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

  it("prints one line per hit in default form", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "needle in the haystack\n");
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await searchCommand(["needle"], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");
    expect(stdout()).toContain(id);
  });

  it("filters by --project", async () => {
    // `#` marks a project (see extractMentions); `@` would mark a tag.
    const db = openDatabase(vaultPath);
    const matching = await saveMemory(db, vaultPath, "shared term #alpha\n");
    await saveMemory(db, vaultPath, "shared term #beta\n");
    closeDatabase(db);

    const { io, stdout } = makeIO();
    const code = await searchCommand(["shared", "--project", "alpha"], io);
    expect(code).toBe(0);

    const lines = stdout().trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(matching);
  });

  it("emits a JSON array with --json", async () => {
    const db = openDatabase(vaultPath);
    await saveMemory(db, vaultPath, "jsonsearchterm here\n");
    closeDatabase(db);

    const { io, stdout } = makeIO();
    const code = await searchCommand(["jsonsearchterm", "--json"], io);
    expect(code).toBe(0);

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
  });

  it("rejects a non-positive --limit", async () => {
    const { io, stderr } = makeIO();
    const code = await searchCommand(["q", "--limit", "0"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("正の整数");
  });

  it("errors with usage when the query is missing", async () => {
    const { io, stderr } = makeIO();
    const code = await searchCommand(["--json"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("使い方");
  });
});
