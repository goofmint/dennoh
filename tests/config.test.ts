import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type Config, DEFAULT_CONFIG, readConfig, resolveLang, writeConfig } from "@/config";

const CONFIG_SUBPATH = path.join("Library", "Application Support", "dennoh");

describe("config", () => {
  let tempDir: string;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  let originalLang: string | undefined;

  beforeEach(() => {
    originalLang = process.env.DENNOH_LANG;
    Reflect.deleteProperty(process.env, "DENNOH_LANG");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-config-"));
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

  function writeRawConfig(payload: object): void {
    const dir = path.join(tempDir, CONFIG_SUBPATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(payload));
  }

  it("round-trips writeConfig → readConfig", () => {
    const cfg: Config = { vaultPath: "/tmp/vault", lang: "en" };
    writeConfig(cfg);
    expect(readConfig()).toEqual(cfg);
  });

  it("creates the config directory recursively on write", () => {
    writeConfig({ vaultPath: "/x", lang: "ja" });
    const expected = path.join(tempDir, CONFIG_SUBPATH, "config.json");
    expect(fs.existsSync(expected)).toBe(true);
  });

  it("throws when the config file is missing", () => {
    expect(() => readConfig()).toThrow();
  });

  it("throws when lang is invalid in the file", () => {
    writeRawConfig({ vaultPath: "/x", lang: "fr" });
    expect(() => readConfig()).toThrow();
  });

  it("throws when vaultPath is not a string", () => {
    writeRawConfig({ vaultPath: 42, lang: "ja" });
    expect(() => readConfig()).toThrow();
  });

  it("throws when the top-level JSON is not an object", () => {
    const dir = path.join(tempDir, CONFIG_SUBPATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(["not", "an", "object"]));
    expect(() => readConfig()).toThrow();
  });

  it("resolveLang prefers DENNOH_LANG env over config", () => {
    writeConfig({ vaultPath: "/x", lang: "ja" });
    process.env.DENNOH_LANG = "en";
    expect(resolveLang()).toBe("en");
  });

  it("resolveLang ignores invalid DENNOH_LANG and falls back to config", () => {
    writeConfig({ vaultPath: "/x", lang: "en" });
    process.env.DENNOH_LANG = "bogus";
    expect(resolveLang()).toBe("en");
  });

  it("resolveLang falls back to default when env and config are both missing", () => {
    expect(resolveLang()).toBe(DEFAULT_CONFIG.lang);
  });

  it("resolveLang priority: env > config > default", () => {
    writeConfig({ vaultPath: "/x", lang: "ja" });

    process.env.DENNOH_LANG = "en";
    expect(resolveLang()).toBe("en");

    Reflect.deleteProperty(process.env, "DENNOH_LANG");
    expect(resolveLang()).toBe("ja");
  });
});
