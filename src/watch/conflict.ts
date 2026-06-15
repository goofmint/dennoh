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
