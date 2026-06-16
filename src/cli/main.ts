#!/usr/bin/env bun

import { type Lang, resolveLang } from "@/config";
import pkg from "../../package.json" with { type: "json" };
import {
  type CliIO,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  addCommand,
  configCommand,
  defaultPromptVaultPath,
  deleteCommand,
  getCommand,
  historyCommand,
  initCommand,
  recentCommand,
  reindexCommand,
  restoreCommand,
  searchCommand,
  serveCommand,
  statusCommand,
  updateCommand,
} from "./index";

// Bilingual top-level help. Command tokens (left column) are language-neutral;
// only the prose descriptions and the section headers differ per language so
// the two columns stay aligned in both. Keep this list in sync with the
// dispatch table below.
const USAGE: Record<Lang, string> = {
  ja: [
    "使い方: dennoh <command> [args]",
    "",
    "コマンド:",
    "  init                        Vault を初期化し dennoh の設定を書き込む",
    '  add "<text>"                新しいメモを作成（標準入力からも可）',
    '  update <id> "<text>"        メモの内容を置き換え（標準入力からも可）',
    "  delete <id>                 メモを削除",
    "  get <id> [--json]           1 件のメモを表示",
    '  search "<query>" [...]      メモを検索（--project --tag --limit --json）',
    "  recent [--limit N] [--json] 最近更新されたメモを一覧表示",
    "  reindex                     ディスク上のメモからインデックスを再構築",
    "  config get <key>            設定値を標準出力に表示",
    "  config set <key> <value>    設定値を更新",
    "  config list                 すべての設定値を一覧表示",
    "  history <id>                メモのコミット履歴を表示（新しい順）",
    "  restore <id> <commitSha>    メモを過去のコミットに復元",
    "  status                      Vault の状態を報告（例: クラウド同期の競合）",
    "  serve                       stdio MCP サーバーを起動",
    "",
    "フラグ:",
    "  --help, -h                  このヘルプを表示",
    "  --version, -v               バージョンを表示",
    "",
  ].join("\n"),
  en: [
    "Usage: dennoh <command> [args]",
    "",
    "Commands:",
    "  init                        Initialize a vault and write dennoh config",
    '  add "<text>"                Create a new note (or read content from stdin)',
    '  update <id> "<text>"        Replace a note\'s content (or read from stdin)',
    "  delete <id>                 Delete a note",
    "  get <id> [--json]           Print a single note",
    '  search "<query>" [...]      Search notes (--project --tag --limit --json)',
    "  recent [--limit N] [--json] List the most-recently-updated notes",
    "  reindex                     Rebuild the index from on-disk notes",
    "  config get <key>            Print a config value to stdout",
    "  config set <key> <value>    Update a config value",
    "  config list                 List all config values",
    "  history <id>                Print a note's commit history (newest first)",
    "  restore <id> <commitSha>    Restore a note to an earlier commit",
    "  status                      Report vault health (e.g. cloud-sync conflicts)",
    "  serve                       Start the stdio MCP server",
    "",
    "Flags:",
    "  --help, -h                  Show this help",
    "  --version, -v               Show version",
    "",
  ].join("\n"),
};

const UNKNOWN_COMMAND: Record<Lang, (cmd: string) => string> = {
  ja: (cmd) => `不明なコマンド: ${cmd}\n\n`,
  en: (cmd) => `Unknown command: ${cmd}\n\n`,
};

function usage(lang: Lang): string {
  return USAGE[lang];
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  const args = argv.slice(2);
  const lang = resolveLang();

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    io.stdout(usage(lang));
    return EXIT_SUCCESS;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout(`${pkg.version}\n`);
    return EXIT_SUCCESS;
  }

  // args is non-empty here (the empty/--help case returned above), so args[0]
  // is always present; the ?? keeps TypeScript's index-access narrowing happy.
  const cmd = args[0] ?? "";
  const rest = args.slice(1);

  if (cmd === "init") {
    return await initCommand({ io, promptVaultPath: defaultPromptVaultPath });
  }
  if (cmd === "add") {
    return await addCommand(rest, io);
  }
  if (cmd === "update") {
    return await updateCommand(rest, io);
  }
  if (cmd === "delete") {
    return await deleteCommand(rest, io);
  }
  if (cmd === "get") {
    return await getCommand(rest, io);
  }
  if (cmd === "search") {
    return await searchCommand(rest, io);
  }
  if (cmd === "recent") {
    return await recentCommand(rest, io);
  }
  if (cmd === "reindex") {
    return await reindexCommand(rest, io);
  }
  if (cmd === "config") {
    return configCommand(rest, io);
  }
  if (cmd === "history") {
    return await historyCommand(rest, io);
  }
  if (cmd === "restore") {
    return await restoreCommand(rest, io);
  }
  if (cmd === "status") {
    return await statusCommand(rest, io);
  }
  if (cmd === "serve") {
    return await serveCommand(rest, io);
  }

  io.stderr(UNKNOWN_COMMAND[lang](cmd));
  io.stderr(usage(lang));
  return EXIT_USER_ERROR;
}

if (import.meta.main) {
  const io: CliIO = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  main(process.argv, io).then((code) => process.exit(code));
}
