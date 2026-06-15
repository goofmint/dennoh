import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { type CliIO, statusCommand } from "@/cli";
import { writeConfig } from "@/config";

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

describe("cli status", () => {
  let homeDir: string;
  let vaultPath: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  let originalLang: string | undefined;

  beforeEach(() => {
    // resolveLang reads DENNOH_LANG first; isolate it so config.lang drives
    // the default and the en test can't leak into the next case.
    originalLang = process.env.DENNOH_LANG;
    Reflect.deleteProperty(process.env, "DENNOH_LANG");

    // readConfig / writeConfig resolve the config path under os.homedir().
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-status-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);

    vaultPath = path.join(homeDir, "vault");
    fs.mkdirSync(vaultPath, { recursive: true });
    writeConfig({ vaultPath, lang: "ja" });
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
    if (originalLang === undefined) {
      Reflect.deleteProperty(process.env, "DENNOH_LANG");
    } else {
      process.env.DENNOH_LANG = originalLang;
    }
  });

  it("reports no conflicts when the vault is clean", async () => {
    fs.writeFileSync(path.join(vaultPath, "note.md"), "x");

    const { io, stdout, stderr } = makeIO();
    const code = await statusCommand([], io);

    expect(code).toBe(0);
    expect(stderr()).toBe("");
    expect(stdout()).toContain("コンフリクトファイルはありません");
  });

  it("lists conflict files across patterns and skips system directories", async () => {
    // A normal nested note must not be reported.
    fs.mkdirSync(path.join(vaultPath, "2026", "06"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, "2026", "06", "note.md"), "x");

    // Three conflict copies spanning the supported patterns, at varying depth.
    fs.writeFileSync(path.join(vaultPath, "note.conflict.md"), "x");
    fs.writeFileSync(path.join(vaultPath, "2026", "memo (conflicted copy).md"), "x");
    fs.writeFileSync(path.join(vaultPath, "2026", "06", "メモ (競合コピー).md"), "x");

    // A conflict-looking file inside .dennoh must be ignored (system dir).
    fs.mkdirSync(path.join(vaultPath, ".dennoh"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, ".dennoh", "internal.conflict.md"), "x");

    const { io, stdout, stderr } = makeIO();
    const code = await statusCommand([], io);

    expect(code).toBe(0);
    expect(stderr()).toBe("");
    const out = stdout();
    expect(out).toContain("警告");
    expect(out).toContain("3 件");
    expect(out).toContain("note.conflict.md");
    expect(out).toContain(path.join("2026", "memo (conflicted copy).md"));
    expect(out).toContain(path.join("2026", "06", "メモ (競合コピー).md"));
    // The system-dir conflict file is excluded from the report.
    expect(out).not.toContain(".dennoh");
  });

  it("rejects unexpected arguments", async () => {
    const { io, stderr } = makeIO();
    const code = await statusCommand(["extra"], io);

    expect(code).toBe(1);
    expect(stderr()).toContain("Unexpected");
  });

  it("emits English messages when lang is en", async () => {
    process.env.DENNOH_LANG = "en";
    fs.writeFileSync(path.join(vaultPath, "draft (conflicted copy).md"), "x");

    const { io, stdout } = makeIO();
    const code = await statusCommand([], io);

    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain("Warning: found 1 conflict file(s)");
    expect(out).toContain("draft (conflicted copy).md");
  });
});
