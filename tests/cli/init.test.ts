// Tests must not pull ~300MB of model weights over the network on every run;
// translateJaToEn / initializeTranslationModel check this env var at call
// time and short-circuit to a no-op when set.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  type CliIO,
  detectCloudSync,
  expandTilde,
  initCommand,
  resolveVaultPath,
  updateGitignore,
} from "@/cli";
import { readConfig } from "@/config";
import { DENNOH_DIR } from "@/core";

function makeIO(): { io: CliIO; stdout: () => string; stderr: () => string } {
  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  return {
    io: {
      stdout: (s: string) => {
        stdoutBuf.push(s);
      },
      stderr: (s: string) => {
        stderrBuf.push(s);
      },
    },
    stdout: () => stdoutBuf.join(""),
    stderr: () => stderrBuf.join(""),
  };
}

describe("cli init", () => {
  let tempDir: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-init-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempDir);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("happy path", () => {
    it("creates vault, .dennoh, .git, .gitignore, and writes config", async () => {
      const vault = path.join(tempDir, "my-vault");
      const { io } = makeIO();
      const code = await initCommand({ io, promptVaultPath: async () => vault });
      expect(code).toBe(0);

      expect(fs.existsSync(vault)).toBe(true);
      expect(fs.existsSync(path.join(vault, ".dennoh"))).toBe(true);
      expect(fs.existsSync(path.join(vault, ".git"))).toBe(true);
      expect(fs.existsSync(path.join(vault, ".gitignore"))).toBe(true);

      const gitignore = fs.readFileSync(path.join(vault, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".dennoh/");

      const cfg = readConfig();
      expect(cfg.vaultPath).toBe(vault);
      expect(cfg.lang).toBe("ja");
    });

    it("expands ~ in vault path", async () => {
      const { io } = makeIO();
      const code = await initCommand({ io, promptVaultPath: async () => "~/my-vault" });
      expect(code).toBe(0);
      const expected = path.join(tempDir, "my-vault");
      expect(fs.existsSync(expected)).toBe(true);
      expect(readConfig().vaultPath).toBe(expected);
    });

    it("trims surrounding whitespace from the prompt input", async () => {
      const vault = path.join(tempDir, "trimmed");
      const { io } = makeIO();
      const code = await initCommand({ io, promptVaultPath: async () => `   ${vault}   ` });
      expect(code).toBe(0);
      expect(readConfig().vaultPath).toBe(vault);
    });
  });

  describe("existing git repo", () => {
    it("skips git init and preserves the existing .git directory", async () => {
      const vault = path.join(tempDir, "already-repo");
      fs.mkdirSync(path.join(vault, ".git"), { recursive: true });
      fs.writeFileSync(path.join(vault, ".git", "MARKER"), "do-not-touch");

      const { io, stdout } = makeIO();
      const code = await initCommand({ io, promptVaultPath: async () => vault });
      expect(code).toBe(0);

      expect(fs.readFileSync(path.join(vault, ".git", "MARKER"), "utf-8")).toBe("do-not-touch");
      expect(stdout()).toContain("existing git repository");
    });
  });

  describe(".gitignore handling", () => {
    it("appends .dennoh/ to a pre-existing .gitignore without removing other entries", async () => {
      const vault = path.join(tempDir, "vault-with-gi");
      fs.mkdirSync(vault, { recursive: true });
      fs.writeFileSync(path.join(vault, ".gitignore"), "node_modules\ndist\n");

      const { io } = makeIO();
      await initCommand({ io, promptVaultPath: async () => vault });

      const gi = fs.readFileSync(path.join(vault, ".gitignore"), "utf-8");
      expect(gi).toContain("node_modules");
      expect(gi).toContain("dist");
      expect(gi).toContain(".dennoh/");
    });

    it("does not duplicate .dennoh/ when already present", async () => {
      const vault = path.join(tempDir, "vault-has-dennoh");
      fs.mkdirSync(vault, { recursive: true });
      fs.writeFileSync(path.join(vault, ".gitignore"), ".dennoh/\n");

      const { io, stdout } = makeIO();
      await initCommand({ io, promptVaultPath: async () => vault });

      const gi = fs.readFileSync(path.join(vault, ".gitignore"), "utf-8");
      const matches = gi.match(/\.dennoh\//g) ?? [];
      expect(matches.length).toBe(1);
      expect(stdout()).toContain("kept .dennoh/");
    });

    it("treats a bare .dennoh entry as already present", () => {
      const vault = fs.mkdtempSync(path.join(tempDir, "gi-bare-"));
      fs.writeFileSync(path.join(vault, ".gitignore"), ".dennoh\n");
      const changed = updateGitignore(vault);
      expect(changed).toBe(false);
    });

    it("creates a new .gitignore containing ${DENNOH_DIR}/ when none existed", async () => {
      const vault = path.join(tempDir, "fresh-vault");
      const { io } = makeIO();
      await initCommand({ io, promptVaultPath: async () => vault });

      const giPath = path.join(vault, ".gitignore");
      expect(fs.existsSync(giPath)).toBe(true);
      const gi = fs.readFileSync(giPath, "utf-8");
      expect(gi).toContain(`${DENNOH_DIR}/`);
    });

    it("uses the DENNOH_DIR constant as the gitignore entry", async () => {
      const vault = path.join(tempDir, "const-check-vault");
      const { io } = makeIO();
      await initCommand({ io, promptVaultPath: async () => vault });

      const gi = fs.readFileSync(path.join(vault, ".gitignore"), "utf-8");
      const lines = gi.split("\n").map((line) => line.trim());
      expect(lines).toContain(`${DENNOH_DIR}/`);
    });
  });

  describe("cloud sync detection", () => {
    it("warns when the vault is inside iCloud Drive", async () => {
      const vault = path.join(
        tempDir,
        "Library",
        "Mobile Documents",
        "iCloud~com~apple~CloudDocs",
        "notes"
      );
      const { io, stderr } = makeIO();
      const result = await initCommand({ io, promptVaultPath: async () => vault });
      expect(result).toBe(0);
      expect(stderr()).toContain("iCloud Drive");
      expect(stderr()).toContain(".git");
      expect(stderr()).toContain(".nosync");
    });

    it("warns when the vault is inside Dropbox", async () => {
      const vault = path.join(tempDir, "Dropbox", "vault");
      const { io, stderr } = makeIO();
      const result = await initCommand({ io, promptVaultPath: async () => vault });
      expect(result).toBe(0);
      expect(stderr()).toContain("Dropbox");
      expect(stderr()).toContain(".dropboxignore");
    });

    it("warns when the vault is inside ~/OneDrive", async () => {
      const vault = path.join(tempDir, "OneDrive", "vault");
      const { io, stderr } = makeIO();
      const result = await initCommand({ io, promptVaultPath: async () => vault });
      expect(result).toBe(0);
      expect(stderr()).toContain("OneDrive");
    });

    it("warns when the vault is inside ~/Library/CloudStorage/OneDrive-Personal/", async () => {
      const vault = path.join(tempDir, "Library", "CloudStorage", "OneDrive-Personal", "vault");
      const { io, stderr } = makeIO();
      const result = await initCommand({ io, promptVaultPath: async () => vault });
      expect(result).toBe(0);
      expect(stderr()).toContain("OneDrive");
    });

    it("does not warn for a non-cloud path", async () => {
      const vault = path.join(tempDir, "plain", "vault");
      const { io, stderr } = makeIO();
      const result = await initCommand({ io, promptVaultPath: async () => vault });
      expect(result).toBe(0);
      const out = stderr().toLowerCase();
      expect(out).not.toContain("dropbox");
      expect(out).not.toContain("icloud");
      expect(out).not.toContain("onedrive");
    });

    it("detectCloudSync returns null for unrelated paths", () => {
      expect(detectCloudSync(path.join(tempDir, "plain"))).toBeNull();
    });
  });

  describe("validation", () => {
    it("rejects empty input", async () => {
      const { io, stderr } = makeIO();
      const code = await initCommand({ io, promptVaultPath: async () => "" });
      expect(code).toBe(1);
      expect(stderr().length).toBeGreaterThan(0);
    });

    it("rejects whitespace-only input", async () => {
      const { io, stderr } = makeIO();
      const code = await initCommand({ io, promptVaultPath: async () => "    " });
      expect(code).toBe(1);
      expect(stderr().length).toBeGreaterThan(0);
    });

    it("expandTilde leaves non-tilde paths alone", () => {
      expect(expandTilde("/abs/path")).toBe("/abs/path");
      expect(expandTilde("relative")).toBe("relative");
    });

    it("expandTilde expands plain ~", () => {
      expect(expandTilde("~")).toBe(tempDir);
    });

    it("resolveVaultPath returns an absolute path", () => {
      const out = resolveVaultPath("~/notes");
      expect(path.isAbsolute(out)).toBe(true);
      expect(out).toBe(path.join(tempDir, "notes"));
    });
  });
});
