import * as fs from "node:fs";
import * as path from "node:path";

// Cloud-sync services (Dropbox, iCloud Drive, OneDrive) resolve concurrent
// edits by writing a duplicate file next to the original with a tagged name.
// These copies are not real notes — indexing them would surface stale,
// duplicated content in search — so we detect and exclude them by filename.
//
// Patterns are matched against the basename only. Adding a new provider or
// locale form is a one-line append to CONFLICT_PATTERNS; the matcher itself
// never changes.
const CONFLICT_PATTERNS: readonly RegExp[] = [
  // Generic convention: `<name>.conflict.md`.
  /\.conflict\.md$/i,
  // Dropbox (English and single-word localized variants): a parenthesized
  // "conflicted copy" / "conflicto" tag before the extension, e.g.
  // `note (Alice's conflicted copy 2024-01-02).md` or `note (conflicto).md`.
  /\(.*conflicted copy.*\)\.md$/i,
  /\(.*conflicto.*\)\.md$/i,
  // Dropbox Japanese locale: a parenthesized "競合コピー" tag, e.g.
  // `メモ (Alice の競合コピー 2024-01-02).md`.
  /\(.*競合コピー.*\)\.md$/,
];

// True when `filename` (a basename, not a full path) looks like a cloud-sync
// conflict copy that should be kept out of the index.
export function isConflictFile(filename: string): boolean {
  return CONFLICT_PATTERNS.some((pattern) => pattern.test(filename));
}

// Recursively collect every conflict copy under `vaultPath`, returning
// vault-relative paths sorted for deterministic output. Used by `dennoh
// status` to surface cloud-sync conflicts the user should resolve.
//
// Directory pruning is intentionally a plain dot-prefix check rather than a
// call into `shouldIgnorePath`: every always-ignored directory (.git,
// .obsidian, .dennoh, .DS_Store) is dot-prefixed, so this prunes them all
// while keeping conflict.ts free of an import cycle with ignore.ts (which
// imports `isConflictFile` from here).
export async function scanConflictFiles(vaultPath: string): Promise<string[]> {
  const found: string[] = [];
  await collectConflicts(vaultPath, vaultPath, found);
  found.sort();
  return found;
}

async function collectConflicts(vaultPath: string, dir: string, found: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    // Best-effort scan: an unreadable directory is skipped rather than
    // aborting the whole status report.
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      await collectConflicts(vaultPath, full, found);
    } else if (entry.isFile() && isConflictFile(entry.name)) {
      found.push(path.relative(vaultPath, full));
    }
  }
}
