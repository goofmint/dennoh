#!/usr/bin/env bun

import pkg from "../../package.json" with { type: "json" };
import { type CliIO, configCommand, defaultPromptVaultPath, initCommand } from "./index";

function usage(): string {
  return [
    "Usage: dennoh <command> [args]",
    "",
    "Commands:",
    "  init                        Initialize a vault and write dennoh config",
    "  config get <key>            Print a config value to stdout",
    "  config set <key> <value>    Update a config value",
    "  config list                 List all config values",
    "  serve                       Start the stdio MCP server (not implemented)",
    "",
    "Flags:",
    "  --help, -h                  Show this help",
    "  --version, -v               Show version",
    "",
  ].join("\n");
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    io.stdout(usage());
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout(`${pkg.version}\n`);
    return 0;
  }

  const cmd = args[0];
  const rest = args.slice(1);

  if (cmd === "init") {
    return await initCommand({ io, promptVaultPath: defaultPromptVaultPath });
  }
  if (cmd === "config") {
    return configCommand(rest, io);
  }
  if (cmd === "serve") {
    io.stderr("'dennoh serve' is not implemented yet.\n");
    return 1;
  }

  io.stderr(`Unknown command: ${cmd}\n\n`);
  io.stderr(usage());
  return 1;
}

if (import.meta.main) {
  const io: CliIO = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  main(process.argv, io).then((code) => process.exit(code));
}
