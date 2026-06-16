// Disable JA→EN translation so saveMemory / updateMemory don't load model
// weights; see restore.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, updateCommand } from "@/cli";
import { writeConfig } from "@/config";
import { saveMemory } from "@/core/memory";
import { closeDatabase, getNoteById, openDatabase, runMigrations } from "@/db";

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

describe("cli update", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-update-home-"));
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

  it("replaces the note content from the text argument", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "before\n");
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await updateCommand([id, "after\n"], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");
    expect(stdout()).toContain(id);

    const db2 = openDatabase(vaultPath);
    const row = getNoteById(db2, id);
    closeDatabase(db2);
    expect(row?.body).toBe("after\n");
  });

  it("reads new content from stdin when the text argument is omitted", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "before\n");
    closeDatabase(db);

    // A real pipe leaves `isTTY` as `undefined` (not `false`); the fake omits
    // it to exercise the `!== true` gate the way a shell pipe actually behaves.
    const piped = Readable.from([Buffer.from("piped after\n")]);
    await withStdin(piped, async () => {
      const { io } = makeIO();
      const code = await updateCommand([id], io);
      expect(code).toBe(0);

      const db2 = openDatabase(vaultPath);
      const row = getNoteById(db2, id);
      closeDatabase(db2);
      expect(row?.body).toBe("piped after\n");
    });
  });

  it("errors for an unknown id", async () => {
    const { io, stderr } = makeIO();
    const code = await updateCommand(["018f0c8e-7c4f-7d3a-8b2e-000000000000", "x\n"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("見つか");
  });

  it("errors with usage when the id is missing", async () => {
    const { io, stderr } = makeIO();
    const code = await updateCommand([], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("使い方");
  });

  it("errors with usage when text is omitted and stdin is a TTY", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "before\n");
    closeDatabase(db);

    await withStdin({ isTTY: true }, async () => {
      const { io, stderr } = makeIO();
      const code = await updateCommand([id], io);
      expect(code).toBe(1);
      expect(stderr()).toContain("使い方");
    });
  });
});
