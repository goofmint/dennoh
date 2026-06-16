// Disable JA→EN translation so saveMemory doesn't load model weights;
// see restore.test.ts for the same guard.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import git from "isomorphic-git";

import { type CliIO, getCommand } from "@/cli";
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

describe("cli get", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-get-home-"));
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

  it("prints frontmatter and body in human-readable form", async () => {
    // `#` marks a project and `@` marks a tag (see extractMentions).
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "the body #projx @tagy\n");
    closeDatabase(db);

    const { io, stdout, stderr } = makeIO();
    const code = await getCommand([id], io);
    expect(code).toBe(0);
    expect(stderr()).toBe("");

    const out = stdout();
    expect(out).toContain(`id: ${id}`);
    expect(out).toContain("projects: projx");
    expect(out).toContain("tags: tagy");
    expect(out).toContain("the body #projx @tagy");
  });

  it("emits valid JSON with --json", async () => {
    const db = openDatabase(vaultPath);
    const id = await saveMemory(db, vaultPath, "json body\n");
    closeDatabase(db);

    const { io, stdout } = makeIO();
    const code = await getCommand([id, "--json"], io);
    expect(code).toBe(0);

    const parsed = JSON.parse(stdout());
    expect(parsed.id).toBe(id);
    expect(parsed.body).toBe("json body\n");
    expect(parsed.frontmatter.source).toBe("note");
  });

  it("errors for an unknown id", async () => {
    const { io, stderr } = makeIO();
    const code = await getCommand(["018f0c8e-7c4f-7d3a-8b2e-000000000000"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("見つか");
  });

  it("errors with usage when the id is missing", async () => {
    const { io, stderr } = makeIO();
    const code = await getCommand(["--json"], io);
    expect(code).toBe(1);
    expect(stderr()).toContain("使い方");
  });

  it("localizes messages in English when DENNOH_LANG=en", async () => {
    // The vault config is lang:ja; the env override takes precedence in
    // resolveLang, so the same usage error must come back in English.
    const prev = process.env.DENNOH_LANG;
    process.env.DENNOH_LANG = "en";
    try {
      const { io, stderr } = makeIO();
      const code = await getCommand([], io);
      expect(code).toBe(1);
      expect(stderr()).toContain("Usage");
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, "DENNOH_LANG");
      } else {
        process.env.DENNOH_LANG = prev;
      }
    }
  });
});
