import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Lang = "ja" | "en";

export interface Config {
  vaultPath: string;
  lang: Lang;
}

export const DEFAULT_CONFIG: Config = {
  vaultPath: "",
  lang: "ja",
};

function getConfigDir(): string {
  return path.join(os.homedir(), "Library", "Application Support", "dennoh");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function isValidLang(value: string | undefined): value is Lang {
  return value === "ja" || value === "en";
}

export function readConfig(): Config {
  const filePath = getConfigPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`dennoh config not found at ${filePath}. Run 'dennoh init' first.`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Invalid config at ${filePath}: expected a JSON object`);
  }
  if (typeof data.vaultPath !== "string") {
    throw new Error(`Invalid config at ${filePath}: vaultPath must be a string`);
  }
  if (!isValidLang(data.lang)) {
    throw new Error(`Invalid config at ${filePath}: lang must be 'ja' or 'en'`);
  }
  return { vaultPath: data.vaultPath, lang: data.lang };
}

export function writeConfig(config: Config): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function resolveLang(): Lang {
  const envLang = process.env.DENNOH_LANG;
  if (isValidLang(envLang)) return envLang;
  try {
    return readConfig().lang;
  } catch {
    return DEFAULT_CONFIG.lang;
  }
}
