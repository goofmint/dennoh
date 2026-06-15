import { type CliIO, readError } from "@/cli/types";
import { type Lang, readConfig, resolveLang } from "@/config";
import { scanConflictFiles } from "@/watch/conflict";

// Bilingual strings for the status report. The project-wide i18n dictionary
// (T12) is not in place yet, so the few strings this command needs live here
// and are selected by resolveLang(). `header` takes the count so the sentence
// reads naturally in both languages.
const MESSAGES: Record<Lang, { none: string; header: (count: number) => string }> = {
  ja: {
    none: "コンフリクトファイルはありません。",
    header: (count) =>
      `警告: ${count} 件のコンフリクトファイルが見つかりました（クラウド同期が原因の可能性があります）:`,
  },
  en: {
    none: "No conflict files found.",
    header: (count) => `Warning: found ${count} conflict file(s) (possibly from cloud sync):`,
  },
};

// `dennoh status` — report vault health. For now this surfaces cloud-sync
// conflict copies so the user can resolve them; the listing is informational,
// so finding conflicts is still a successful run (exit 0).
export async function statusCommand(args: string[], io: CliIO): Promise<number> {
  if (args.length > 0) {
    io.stderr(`Unexpected arguments for 'status': ${args.join(" ")}\n`);
    return 1;
  }

  let vaultPath: string;
  try {
    vaultPath = readConfig().vaultPath;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  let conflicts: string[];
  try {
    conflicts = await scanConflictFiles(vaultPath);
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  const messages = MESSAGES[resolveLang()];
  if (conflicts.length === 0) {
    io.stdout(`${messages.none}\n`);
    return 0;
  }

  io.stdout(`${messages.header(conflicts.length)}\n`);
  for (const relativePath of conflicts) {
    io.stdout(`  ${relativePath}\n`);
  }
  return 0;
}
