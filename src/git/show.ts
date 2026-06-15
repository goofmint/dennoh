import * as fs from "node:fs";

import git from "isomorphic-git";

import { toRelative } from "./commit";

// Returns the UTF-8 contents of `filePath` as it existed at `commitSha`.
//
// The commit is resolved explicitly via `readCommit` first: `readBlob` would
// also throw for a bad SHA, but it cannot distinguish "the commit does not
// exist" from "the file was not present in that commit". Checking the commit
// up front lets each failure surface a precise, actionable message instead of
// isomorphic-git's generic NotFound error — and honors the project policy of
// failing loudly rather than papering over a missing object.
export async function gitShow(
  vaultPath: string,
  filePath: string,
  commitSha: string
): Promise<string> {
  const relativePath = toRelative(vaultPath, filePath);

  try {
    await git.readCommit({ fs, dir: vaultPath, oid: commitSha });
  } catch (cause) {
    throw new Error(
      `commit ${JSON.stringify(commitSha)} does not exist in vault ${JSON.stringify(vaultPath)}`,
      { cause }
    );
  }

  let blob: Uint8Array;
  try {
    const result = await git.readBlob({
      fs,
      dir: vaultPath,
      oid: commitSha,
      filepath: relativePath,
    });
    blob = result.blob;
  } catch (cause) {
    throw new Error(
      `file ${JSON.stringify(relativePath)} does not exist in commit ${JSON.stringify(commitSha)}`,
      { cause }
    );
  }

  // The blob is raw bytes; notes are UTF-8 markdown, so decode accordingly.
  return new TextDecoder("utf-8").decode(blob);
}
