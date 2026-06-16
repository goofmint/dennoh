// Disable JA→EN translation so saveMemory doesn't load model weights;
// see restore.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, recentCommand } from "@/cli";
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

describe("cli recent", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-recent-home-"));
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

  it("lists notes one per line and respects --limit", async () => {
    const db = openDatabase(vaultPath);
    await saveMemory(db, vaultPath, "first\n");
    await saveMemory(db, vaultPath, "second\n");
    await saveMemory(db, vaultPath, "third\n");
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await recentCommand(["--limit", "2"], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");

    const lines = stdout().trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("deserializes projects/tags in --json output", async () => {
    // `#` marks a project and `@` marks a tag (see extractMentions).
    const db = openDatabase(vaultPath);
    await saveMemory(db, vaultPath, "tagged #proj @topic\n");
    closeDatabase(db);

    const { io, stdout } = makeIO();
    const code = await recentCommand(["--json"], io);
    expect(code).toBe(0);

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].projects).toEqual(["proj"]);
    expect(parsed[0].tags).toEqual(["topic"]);
    expect(parsed[0].id).toBeDefined();
    // Raw *_json columns are replaced by the parsed arrays.
    expect(parsed[0].projects_json).toBeUndefined();
    expect(parsed[0].tags_json).toBeUndefined();
  });

  it("rejects a non-positive --limit", async () => {
    // A negative value must use the `--limit=-3` form: in the space-separated
    // form a `-`-prefixed token is treated as a missing value, not a number.
    const { io, stderr } = makeIO();
    const code = await recentCommand(["--limit=-3"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("正の整数");
  });

  it("rejects --limit given without a value", async () => {
    const { io, stderr } = makeIO();
    const code = await recentCommand(["--limit"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("値が必要");
  });

  it("errors on unexpected positional arguments", async () => {
    const { io, stderr } = makeIO();
    const code = await recentCommand(["stray"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("予期しない");
  });
});
