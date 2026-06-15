import * as path from "node:path";

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

// Reject relative paths at the boundary. The contract is "both producers — the
// CRUD path-builders and the watcher's path.join with vaultPath — yield the
// same absolute key". A relative path here would never match the absolute key
// the other side produces, so the marker would silently fail to suppress the
// self-write. Throwing surfaces the bug at the call site instead.
function assertAbsolute(absolutePath: string, fn: string): void {
  if (!path.isAbsolute(absolutePath)) {
    throw new Error(`${fn}: path must be absolute, got ${JSON.stringify(absolutePath)}`);
  }
}

export function markWriteStart(absolutePath: string): void {
  assertAbsolute(absolutePath, "markWriteStart");
  pendingWrites.add(absolutePath);
}

// Safe to call for a path that is not currently in the set — `Set#delete`
// returns false and is a no-op. Callers use this from `finally` blocks where
// re-entering with an already-cleared path is possible (e.g. an exception
// in a nested finally).
export function markWriteEnd(absolutePath: string): void {
  assertAbsolute(absolutePath, "markWriteEnd");
  pendingWrites.delete(absolutePath);
}

export function isOwnWrite(absolutePath: string): boolean {
  assertAbsolute(absolutePath, "isOwnWrite");
  return pendingWrites.has(absolutePath);
}
