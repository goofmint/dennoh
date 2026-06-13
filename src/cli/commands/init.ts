import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";

import type { CliIO } from "@/cli/types";
import { writeConfig } from "@/config";

export type PromptVaultPathFn = (io: CliIO) => Promise<string>;

export type InitDeps = {
  io: CliIO;
  promptVaultPath: PromptVaultPathFn;
};

export type CloudService = "iCloud Drive" | "Dropbox" | "OneDrive";

export type CloudMatch = {
  service: CloudService;
  vaultPath: string;
};

function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function expandTilde(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolveVaultPath(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    throw new Error("Vault path must not be empty.");
  }
  return path.resolve(expandTilde(trimmed));
}

export function ensureVaultDirs(vaultPath: string): void {
  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(path.join(vaultPath, ".dennoh"), { recursive: true });
}

export function initGitRepo(vaultPath: string, io: CliIO): boolean {
  const gitDir = path.join(vaultPath, ".git");
  if (fs.existsSync(gitDir)) {
    io.stdout(`Using existing git repository at ${vaultPath}.\n`);
    return false;
  }
  const result = Bun.spawnSync(["git", "init"], {
    cwd: vaultPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`git init failed: ${stderr.trim() || `exit code ${result.exitCode}`}`);
  }
  return true;
}

export function updateGitignore(vaultPath: string): boolean {
  const giPath = path.join(vaultPath, ".gitignore");
  const entry = ".dennoh/";
  const existing = fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf-8") : "";
  const lines = existing.split("\n").map((line) => line.trim());
  if (lines.includes(entry) || lines.includes(".dennoh") || lines.includes(".dennoh/*")) {
    return false;
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(giPath, `${existing}${prefix}${entry}\n`);
  return true;
}

export function detectCloudSync(vaultPath: string): CloudMatch | null {
  const home = os.homedir();
  const startsUnder = (root: string): boolean =>
    vaultPath === root || vaultPath.startsWith(`${root}${path.sep}`);

  if (startsUnder(path.join(home, "Library", "Mobile Documents"))) {
    return { service: "iCloud Drive", vaultPath };
  }
  if (startsUnder(path.join(home, "Dropbox"))) {
    return { service: "Dropbox", vaultPath };
  }
  if (startsUnder(path.join(home, "OneDrive"))) {
    return { service: "OneDrive", vaultPath };
  }
  const cloudStorage = path.join(home, "Library", "CloudStorage");
  if (vaultPath.startsWith(`${cloudStorage}${path.sep}`)) {
    const rel = path.relative(cloudStorage, vaultPath);
    const firstSegment = rel.split(path.sep)[0];
    if (firstSegment?.startsWith("OneDrive")) {
      return { service: "OneDrive", vaultPath };
    }
  }
  return null;
}

export function formatCloudWarning(match: CloudMatch): string {
  const lines = [
    `Warning: ${match.vaultPath} is inside ${match.service}.`,
    `Excluding ${path.join(match.vaultPath, ".git")} from sync is strongly recommended to avoid repository corruption.`,
  ];
  if (match.service === "iCloud Drive") {
    lines.push("  - iCloud Drive: rename .git to .git.nosync, or move .git outside iCloud.");
  } else if (match.service === "Dropbox") {
    lines.push("  - Dropbox: add '.git' to .dropboxignore at the sync root.");
  } else {
    lines.push("  - OneDrive: configure file exclusion via the OneDrive client.");
  }
  return `${lines.join("\n")}\n`;
}

export async function defaultPromptVaultPath(_io: CliIO): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question("Enter vault folder path: ");
  } finally {
    rl.close();
  }
}

export async function initCommand(deps: InitDeps): Promise<number> {
  const { io, promptVaultPath } = deps;
  let vaultPath: string;
  try {
    const raw = await promptVaultPath(io);
    vaultPath = resolveVaultPath(raw);
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  try {
    ensureVaultDirs(vaultPath);
    initGitRepo(vaultPath, io);
    const gitignoreChanged = updateGitignore(vaultPath);
    writeConfig({ vaultPath, lang: "ja" });

    io.stdout(`Initialized vault at ${vaultPath}\n`);
    io.stdout(`  - created ${path.join(vaultPath, ".dennoh")}\n`);
    io.stdout(`  - ${gitignoreChanged ? "added" : "kept"} .dennoh/ in .gitignore\n`);
    io.stdout("  - wrote dennoh config\n");

    const cloud = detectCloudSync(vaultPath);
    if (cloud !== null) {
      io.stderr(formatCloudWarning(cloud));
    }
    return 0;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }
}
