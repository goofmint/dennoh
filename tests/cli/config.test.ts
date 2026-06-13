import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type CliIO, configCommand } from "@/cli";
import { readConfig, writeConfig } from "@/config";

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

describe("cli config", () => {
  let tempDir: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  let originalLang: string | undefined;

  beforeEach(() => {
    originalLang = process.env.DENNOH_LANG;
    Reflect.deleteProperty(process.env, "DENNOH_LANG");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-cli-config-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempDir);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalLang === undefined) {
      Reflect.deleteProperty(process.env, "DENNOH_LANG");
    } else {
      process.env.DENNOH_LANG = originalLang;
    }
  });

  describe("set then get", () => {
    it("set lang en, then get lang outputs en", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });

      const set = makeIO();
      expect(configCommand(["set", "lang", "en"], set.io)).toBe(0);

      const get = makeIO();
      expect(configCommand(["get", "lang"], get.io)).toBe(0);
      expect(get.stdout()).toBe("en\n");
    });

    it("set vaultPath, then get vaultPath outputs the new value", () => {
      writeConfig({ vaultPath: "/old", lang: "ja" });

      const set = makeIO();
      expect(configCommand(["set", "vaultPath", "/new/vault"], set.io)).toBe(0);

      const get = makeIO();
      expect(configCommand(["get", "vaultPath"], get.io)).toBe(0);
      expect(get.stdout()).toBe("/new/vault\n");
    });

    it("set persists across read", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io } = makeIO();
      configCommand(["set", "lang", "en"], io);
      expect(readConfig()).toEqual({ vaultPath: "/x", lang: "en" });
    });
  });

  describe("list", () => {
    it("outputs key=value lines for every field", () => {
      writeConfig({ vaultPath: "/my/vault", lang: "en" });
      const { io, stdout } = makeIO();
      expect(configCommand(["list"], io)).toBe(0);
      const lines = stdout().trim().split("\n");
      expect(lines).toContain("vaultPath=/my/vault");
      expect(lines).toContain("lang=en");
    });

    it("annotates lang with DENNOH_LANG when env override is active", () => {
      writeConfig({ vaultPath: "/my/vault", lang: "ja" });
      process.env.DENNOH_LANG = "en";
      const { io, stdout } = makeIO();
      expect(configCommand(["list"], io)).toBe(0);
      expect(stdout()).toContain("lang=en (from DENNOH_LANG)");
    });

    it("ignores invalid DENNOH_LANG and shows the config value plain", () => {
      writeConfig({ vaultPath: "/my/vault", lang: "ja" });
      process.env.DENNOH_LANG = "bogus";
      const { io, stdout } = makeIO();
      expect(configCommand(["list"], io)).toBe(0);
      expect(stdout()).toContain("lang=ja\n");
      expect(stdout()).not.toContain("DENNOH_LANG");
    });

    it("exits 1 with a stderr message when config is missing", () => {
      const { io, stderr, stdout } = makeIO();
      expect(configCommand(["list"], io)).toBe(1);
      expect(stderr().length).toBeGreaterThan(0);
      expect(stdout()).toBe("");
    });
  });

  describe("get errors", () => {
    it("get with unknown key exits 1", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io, stderr } = makeIO();
      expect(configCommand(["get", "nope"], io)).toBe(1);
      expect(stderr()).toContain("Unknown config key");
    });

    it("get lang exits 1 when config is missing", () => {
      const { io, stderr } = makeIO();
      expect(configCommand(["get", "lang"], io)).toBe(1);
      expect(stderr().length).toBeGreaterThan(0);
    });

    it("get vaultPath exits 1 when config is missing", () => {
      const { io, stderr } = makeIO();
      expect(configCommand(["get", "vaultPath"], io)).toBe(1);
      expect(stderr().length).toBeGreaterThan(0);
    });

    it("get without key exits 1", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io, stderr } = makeIO();
      expect(configCommand(["get"], io)).toBe(1);
      expect(stderr()).toContain("Usage");
    });
  });

  describe("set errors", () => {
    it("invalid lang value exits 1 and does not modify config", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io, stderr } = makeIO();
      expect(configCommand(["set", "lang", "fr"], io)).toBe(1);
      expect(stderr()).toContain("Invalid lang");
      expect(readConfig().lang).toBe("ja");
    });

    it("empty vaultPath exits 1 and does not modify config", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io, stderr } = makeIO();
      expect(configCommand(["set", "vaultPath", ""], io)).toBe(1);
      expect(stderr()).toContain("non-empty");
      expect(readConfig().vaultPath).toBe("/x");
    });

    it("unknown key exits 1", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io, stderr } = makeIO();
      expect(configCommand(["set", "nope", "v"], io)).toBe(1);
      expect(stderr()).toContain("Unknown config key");
    });

    it("missing value exits 1", () => {
      writeConfig({ vaultPath: "/x", lang: "ja" });
      const { io, stderr } = makeIO();
      expect(configCommand(["set", "lang"], io)).toBe(1);
      expect(stderr()).toContain("Usage");
    });

    it("set lang on missing config exits 1", () => {
      const { io, stderr } = makeIO();
      expect(configCommand(["set", "lang", "en"], io)).toBe(1);
      expect(stderr().length).toBeGreaterThan(0);
    });
  });

  describe("routing", () => {
    it("unknown subcommand exits 1", () => {
      const { io, stderr } = makeIO();
      expect(configCommand(["weird"], io)).toBe(1);
      expect(stderr()).toContain("Unknown config subcommand");
    });

    it("no subcommand exits 1 with usage", () => {
      const { io, stderr } = makeIO();
      expect(configCommand([], io)).toBe(1);
      expect(stderr()).toContain("Usage");
    });
  });
});
