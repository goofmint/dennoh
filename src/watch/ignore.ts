import { DENNOH_DIR } from "@/core/path";

import { isConflictFile } from "./conflict";

// Names that are always ignored, independent of how deep they sit in the tree.
// `.git` / `.obsidian` / `.dennoh` are explicitly listed (rather than relying on
// the dot-prefix rule below) so a future change to that rule cannot accidentally
// re-enable indexing of these trees, which would corrupt the index with VCS
// state, plugin caches, or our own SQLite/git internals.
const ALWAYS_IGNORE_NAMES: ReadonlySet<string> = new Set([
  ".DS_Store",
  ".git",
  ".obsidian",
  DENNOH_DIR,
]);

// Decide whether a vault-relative path should be excluded from the watcher
// pipeline. Operates on path segments so a hidden ancestor anywhere in the
// chain (e.g. `notes/.obsidian/workspace.json`) wins, not just the basename.
//
// Empty input and leading-separator inputs are normalized via the segment
// filter — `"".split(...)` and `"/foo".split(...)` both produce an empty
// segment that we drop, so callers do not have to canonicalize first.
export function shouldIgnorePath(relativePath: string): boolean {
  const segments = relativePath.split(/[/\\]/).filter((seg) => seg.length > 0);
  for (const segment of segments) {
    if (ALWAYS_IGNORE_NAMES.has(segment)) {
      return true;
    }
    // Any other dot-prefixed segment is treated as hidden. This covers
    // editor temp files (e.g. `.swp`), other VCS dirs (`.hg`, `.svn`), and
    // our own atomic-write tempfiles (`.tmp.<uuid>` produced by writeFileAtomic)
    // without us having to enumerate them.
    if (segment.startsWith(".")) {
      return true;
    }
  }
  // Cloud-sync conflict copies carry a normal-looking, non-dot name and live
  // beside the real note, so they pass the segment checks above. Inspect the
  // last segment (the filename) for a conflict-copy pattern. We use the split
  // segments rather than `path.basename` so the backslash-separator handling
  // stays consistent with the loop.
  const basename = segments.at(-1);
  if (basename !== undefined && isConflictFile(basename)) {
    return true;
  }
  return false;
}
