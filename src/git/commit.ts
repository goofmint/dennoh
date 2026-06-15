import * as fs from "node:fs";
import * as path from "node:path";

import git from "isomorphic-git";

// isomorphic-git expects `filepath` to be relative to `dir`. Callers in the
// dennoh codebase pass absolute paths produced by `buildNotePath`, so we
// normalize here rather than forcing every call site to remember the rule.
//
// Defense-in-depth: reject any result that escapes the vault. `assertSafeNoteId`
// already prevents id-level traversal, but `toRelative` is reachable from any
// future caller — guarding here closes the gap permanently and makes the
// invariant local to the function rather than spread across upstream code.
export function toRelative(vaultPath: string, filePath: string): string {
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

// Resolves the author identity from the local git config. Fails loudly when
// either `user.name` or `user.email` is missing rather than silently
// substituting a placeholder identity — per project policy "fallback
// processing is absolutely forbidden". Both fields are read independently
// because either can be set without the other; isomorphic-git's `commit()`
// requires both, so a partial config is just as broken as no config.
async function resolveAuthor(vaultPath: string): Promise<{ name: string; email: string }> {
  const [configuredName, configuredEmail] = await Promise.all([
    git.getConfig({ fs, dir: vaultPath, path: "user.name" }),
    git.getConfig({ fs, dir: vaultPath, path: "user.email" }),
  ]);
  // Whitespace-only values like `"   "` are treated as unset: an identity
  // composed entirely of whitespace yields an uninformative author entry
  // and almost always indicates a misconfigured git setup. We check the
  // trimmed length but pass the original string through unchanged — the
  // contract is "reject if effectively empty", not "silently normalize".
  if (typeof configuredName !== "string" || configuredName.trim().length === 0) {
    throw new Error(
      `git user.name is not configured for vault ${JSON.stringify(vaultPath)}; set it before committing (e.g., \`git config user.name <name>\`).`
    );
  }
  if (typeof configuredEmail !== "string" || configuredEmail.trim().length === 0) {
    throw new Error(
      `git user.email is not configured for vault ${JSON.stringify(vaultPath)}; set it before committing (e.g., \`git config user.email <email>\`).`
    );
  }
  return { name: configuredName, email: configuredEmail };
}

export async function gitCommit(vaultPath: string, message: string): Promise<string> {
  const author = await resolveAuthor(vaultPath);
  return await git.commit({ fs, dir: vaultPath, message, author });
}
