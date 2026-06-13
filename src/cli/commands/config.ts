import type { CliIO } from "@/cli/types";
import { type Config, readConfig, resolveLang, writeConfig } from "@/config";

function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function configGet(args: string[], io: CliIO): number {
  const key = args[0];
  if (!key) {
    io.stderr("Usage: dennoh config get <key>\n");
    return 1;
  }

  if (key === "lang") {
    const envLang = process.env.DENNOH_LANG;
    if (envLang === "ja" || envLang === "en") {
      io.stdout(`${resolveLang()}\n`);
      return 0;
    }
    try {
      readConfig();
    } catch (e) {
      io.stderr(`${readError(e)}\n`);
      return 1;
    }
    io.stdout(`${resolveLang()}\n`);
    return 0;
  }

  if (key === "vaultPath") {
    try {
      const cfg = readConfig();
      io.stdout(`${cfg.vaultPath}\n`);
      return 0;
    } catch (e) {
      io.stderr(`${readError(e)}\n`);
      return 1;
    }
  }

  io.stderr(`Unknown config key: ${key}. Valid keys: lang, vaultPath\n`);
  return 1;
}

export function configSet(args: string[], io: CliIO): number {
  const key = args[0];
  const value = args[1];
  if (!key || value === undefined) {
    io.stderr("Usage: dennoh config set <key> <value>\n");
    return 1;
  }

  if (key === "lang") {
    if (value !== "ja" && value !== "en") {
      io.stderr(`Invalid lang: ${value}. Must be 'ja' or 'en'.\n`);
      return 1;
    }
    let next: Config;
    try {
      next = readConfig();
    } catch (e) {
      io.stderr(`${readError(e)}\n`);
      return 1;
    }
    next.lang = value;
    try {
      writeConfig(next);
    } catch (e) {
      io.stderr(`${readError(e)}\n`);
      return 1;
    }
    return 0;
  }

  if (key === "vaultPath") {
    if (value.length === 0) {
      io.stderr("vaultPath must be a non-empty string.\n");
      return 1;
    }
    let next: Config;
    try {
      next = readConfig();
    } catch (e) {
      io.stderr(`${readError(e)}\n`);
      return 1;
    }
    next.vaultPath = value;
    try {
      writeConfig(next);
    } catch (e) {
      io.stderr(`${readError(e)}\n`);
      return 1;
    }
    return 0;
  }

  io.stderr(`Unknown config key: ${key}. Valid keys: lang, vaultPath\n`);
  return 1;
}

export function configList(args: string[], io: CliIO): number {
  if (args.length > 0) {
    io.stderr(`Unexpected arguments for 'config list': ${args.join(" ")}\n`);
    return 1;
  }

  let cfg: Config;
  try {
    cfg = readConfig();
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  io.stdout(`vaultPath=${cfg.vaultPath}\n`);
  const envLang = process.env.DENNOH_LANG;
  if (envLang === "ja" || envLang === "en") {
    io.stdout(`lang=${envLang} (from DENNOH_LANG)\n`);
  } else {
    io.stdout(`lang=${cfg.lang}\n`);
  }
  return 0;
}

export function configCommand(args: string[], io: CliIO): number {
  const sub = args[0];
  if (!sub) {
    io.stderr("Usage: dennoh config <get|set|list> [args]\n");
    return 1;
  }
  const rest = args.slice(1);
  if (sub === "get") return configGet(rest, io);
  if (sub === "set") return configSet(rest, io);
  if (sub === "list") return configList(rest, io);
  io.stderr(`Unknown config subcommand: ${sub}. Valid subcommands: get, set, list\n`);
  return 1;
}
