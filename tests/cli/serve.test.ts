import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { type CliIO, serveCommand } from "@/cli";

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

// These tests exercise only the pre-connection paths (validation + config
// failure), which return before opening stdio. The live stdio loop blocks
// until disconnect and is covered by mcp/server.test.ts via an in-memory pair.
describe("cli serve", () => {
  let homeDir: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-serve-home-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("rejects unexpected arguments without touching stdout", async () => {
    const { io, stdout, stderr } = makeIO();
    const code = await serveCommand(["extra"], io);

    expect(code).toBe(1);
    expect(stderr()).toContain("Unexpected");
    // stdout is reserved for the MCP protocol stream — nothing else may write it.
    expect(stdout()).toBe("");
  });

  it("fails with a config error when no config exists, writing only to stderr", async () => {
    // homedir points at an empty dir, so readConfig throws "config not found"
    // before the server ever connects.
    const { io, stdout, stderr } = makeIO();
    const code = await serveCommand([], io);

    expect(code).toBe(1);
    expect(stderr().length).toBeGreaterThan(0);
    expect(stdout()).toBe("");
  });
});
