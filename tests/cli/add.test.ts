import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, EXIT_INTERNAL_ERROR, addCommand } from "@/cli";
import { writeConfig } from "@/config";
import { closeDatabase, getNoteById, openDatabase } from "@/db";

// Temporarily swap process.stdin for a fake while `fn` runs, then restore the
// original descriptor. bun:test's spyOn type signature doesn't accept the
// accessor (get) form, so we override the property directly instead.
async function withStdin(fake: unknown, fn: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", { configurable: true, get: () => fake });
  try {
    await fn();
  } finally {
    if (original) Object.defineProperty(process, "stdin", original);
  }
}

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

describe("cli add", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  // Scope DENNOH_TRANSLATE_DISABLE per-test (disable JA→EN translation so
  // saveMemory doesn't load model weights) and restore it afterwards so the
  // env mutation does not leak into other suites in the same process.
  let prevTranslateDisable: string | undefined;

  beforeEach(async () => {
    prevTranslateDisable = process.env.DENNOH_TRANSLATE_DISABLE;
    process.env.DENNOH_TRANSLATE_DISABLE = "1";

    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-add-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

    vaultPath = path.join(homeDir, "vault");
    fs.mkdirSync(vaultPath, { recursive: true });
    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });

    writeConfig({ vaultPath, lang: "ja" });
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
    prevTranslateDisable === undefined
      ? Reflect.deleteProperty(process.env, "DENNOH_TRANSLATE_DISABLE")
      : Reflect.set(process.env, "DENNOH_TRANSLATE_DISABLE", prevTranslateDisable);
  });

  it("saves the argument content and prints the new id", async () => {
    const { io, stdout, stderr } = makeIO();
    const code = await addCommand(["hello world\n"], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");

    const id = stdout().trim();
    expect(id.length).toBeGreaterThan(0);

    const db = openDatabase(vaultPath);
    const row = getNoteById(db, id);
    closeDatabase(db);
    expect(row?.body).toBe("hello world\n");
  });

  it("reads content from stdin when no argument is given and stdin is piped", async () => {
    // A readable carrying the payload mirrors `echo ... | dennoh add`. A real
    // pipe leaves `isTTY` as `undefined` (not `false`), so the fake omits it —
    // this is exactly the case the `!== true` gate must catch.
    const piped = Readable.from([Buffer.from("from stdin\n")]);
    await withStdin(piped, async () => {
      const { io, stdout } = makeIO();
      const code = await addCommand([], io);
      expect(code).toBe(0);

      const id = stdout().trim();
      const db = openDatabase(vaultPath);
      const row = getNoteById(db, id);
      closeDatabase(db);
      expect(row?.body).toBe("from stdin\n");
    });
  });

  it("errors with usage when no argument and stdin is a TTY", async () => {
    await withStdin({ isTTY: true }, async () => {
      const { io, stderr } = makeIO();
      const code = await addCommand([], io);
      expect(code).toBe(1);
      expect(stderr()).toContain("使い方");
    });
  });

  it("runs migrations so `add` works on a fresh vault", async () => {
    // No openDatabase + runMigrations in beforeEach for this vault path; the
    // command itself must initialize the schema.
    const { io, stdout } = makeIO();
    const code = await addCommand(["fresh vault\n"], io);
    expect(code).toBe(0);

    const id = stdout().trim();
    const db = openDatabase(vaultPath);
    const row = getNoteById(db, id);
    closeDatabase(db);
    expect(row?.body).toBe("fresh vault\n");
  });

  it("returns EXIT_INTERNAL_ERROR when the database cannot be opened", async () => {
    // Point the vault at a path whose parent is a regular file, so
    // openDatabase's recursive mkdir of `.dennoh` fails with ENOTDIR. config
    // still reads cleanly, so this exercises the DB-open (internal) branch,
    // which must exit with code 2 rather than the user-error code 1.
    const filePath = path.join(homeDir, "not-a-dir");
    fs.writeFileSync(filePath, "x");
    writeConfig({ vaultPath: path.join(filePath, "vault"), lang: "ja" });

    const { io, stderr } = makeIO();
    const code = await addCommand(["content"], io);
    expect(code).toBe(EXIT_INTERNAL_ERROR);
    expect(stderr()).not.toBe("");
  });
});
