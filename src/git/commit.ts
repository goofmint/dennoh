import * as fs from "node:fs";
import * as path from "node:path";

import git from "isomorphic-git";

const DEFAULT_AUTHOR_NAME = "dennoh";
const DEFAULT_AUTHOR_EMAIL = "dennoh@localhost";

// isomorphic-git expects `filepath` to be relative to `dir`. Callers in the
// dennoh codebase pass absolute paths produced by `buildNotePath`, so we
// normalize here rather than forcing every call site to remember the rule.
//
// Defense-in-depth: reject any result that escapes the vault. `assertSafeNoteId`
// already prevents id-level traversal, but `toRelative` is reachable from any
// future caller — guarding here closes the gap permanently and makes the
// invariant local to the function rather than spread across upstream code.
function toRelative(vaultPath: string, filePath: string): string {
  const relative = path.isAbsolute(filePath) ? path.relative(vaultPath, filePath) : filePath;
  const segments = relative.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `git path escapes the vault: ${JSON.stringify(filePath)} (vault=${JSON.stringify(vaultPath)})`
    );
  }
  return relative;
}

export async function gitAdd(vaultPath: string, filePath: string): Promise<void> {
  await git.add({ fs, dir: vaultPath, filepath: toRelative(vaultPath, filePath) });
}

// `gitAdd` cannot stage a deletion (isomorphic-git's `add` reads the file
// contents), so the delete path uses `git.remove` to remove the entry from
// the index. The working-tree `.md` file is expected to already be gone
// when callers reach this point — `gitRemove` only touches git state.
export async function gitRemove(vaultPath: string, filePath: string): Promise<void> {
  await git.remove({ fs, dir: vaultPath, filepath: toRelative(vaultPath, filePath) });
}

// Resolves the author identity from the local git config, falling back to
// the dennoh-default identity when the user has not configured one. We pull
// name and email independently because either can be set without the other —
// isomorphic-git's `commit()` requires both fields to be present.
async function resolveAuthor(vaultPath: string): Promise<{ name: string; email: string }> {
  const [configuredName, configuredEmail] = await Promise.all([
    git.getConfig({ fs, dir: vaultPath, path: "user.name" }),
    git.getConfig({ fs, dir: vaultPath, path: "user.email" }),
  ]);
  return {
    name: configuredName ?? DEFAULT_AUTHOR_NAME,
    email: configuredEmail ?? DEFAULT_AUTHOR_EMAIL,
  };
}

export async function gitCommit(vaultPath: string, message: string): Promise<string> {
  const author = await resolveAuthor(vaultPath);
  return await git.commit({ fs, dir: vaultPath, message, author });
}
