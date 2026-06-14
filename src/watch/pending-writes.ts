// Tracks the absolute paths that our own writers are currently touching so the
// future watcher can distinguish "the user (or sync agent) edited this file"
// from "we just rewrote this file ourselves" and skip the latter.
//
// Module-level Set is intentional: the registry is process-global because there
// is exactly one watcher per dennoh process. Bun's event loop is single-threaded
// so Set ops are race-free without locks; the only concurrency we need to worry
// about is interleaving between async writers and the watcher callback within
// the same loop, which a synchronous Set check / mutate handles cleanly.
//
// Paths must be absolute. The watcher receives absolute paths from fs.watch
// recursive mode (after we join its `filename` argument with the vault root),
// and the CRUD path-builders (`buildNotePath`) also return absolute paths once
// the vaultPath argument is absolute. Both sides agree on the same key without
// further normalization.
const pendingWrites = new Set<string>();

export function markWriteStart(absolutePath: string): void {
  pendingWrites.add(absolutePath);
}

// Safe to call for a path that is not currently in the set — `Set#delete`
// returns false and is a no-op. Callers use this from `finally` blocks where
// re-entering with an already-cleared path is possible (e.g. an exception
// in a nested finally).
export function markWriteEnd(absolutePath: string): void {
  pendingWrites.delete(absolutePath);
}

export function isOwnWrite(absolutePath: string): boolean {
  return pendingWrites.has(absolutePath);
}
