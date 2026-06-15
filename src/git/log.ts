import * as fs from "node:fs";

import git from "isomorphic-git";

import { toRelative } from "./commit";

// A single commit that touched the requested file. `timestamp` is a `Date`
// (not the raw Unix-seconds value isomorphic-git exposes) so callers — the
// upcoming CLI history command in particular — never have to remember the
// unit conversion or the *1000 factor.
export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  timestamp: Date;
}

// Returns the commit history for a single file, newest first.
//
// `git.log` walks the whole branch; passing `filepath` makes isomorphic-git
// drop commits in which the file's blob did not change, so unrelated commits
// are excluded at the source rather than filtered here. The path is converted
// to a vault-relative form through the shared `toRelative` guard, which also
// rejects any path that escapes the vault.
export async function gitLog(vaultPath: string, filePath: string): Promise<CommitInfo[]> {
  const commits = await git.log({
    fs,
    dir: vaultPath,
    filepath: toRelative(vaultPath, filePath),
  });

  return commits.map((entry) => ({
    sha: entry.oid,
    // Keep only the subject line (first line). dennoh's own commits are
    // single-line, but the vault is a real repo a user may commit to with a
    // multi-line message; the history view renders one commit per line, so an
    // internal newline must not leak into the output.
    message: (entry.commit.message.split("\n")[0] ?? "").trim(),
    author: entry.commit.author.name,
    // isomorphic-git reports the author time in whole seconds; Date expects ms.
    timestamp: new Date(entry.commit.author.timestamp * 1000),
  }));
}
