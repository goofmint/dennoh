import * as fs from "node:fs";

import git from "isomorphic-git";

import { toRelative } from "./commit";

// isomorphic-git tags its "object/ref not found" failures with this code. We
// narrow to it so that only a genuinely missing commit/file is reported as
// such; a real repository or I/O error (corrupt object, permission denied)
// keeps its original error rather than being mislabeled as "does not exist".
function isNotFoundError(cause: unknown): boolean {
  return cause instanceof Error && (cause as Error & { code?: string }).code === "NotFoundError";
}

// Returns the UTF-8 contents of `filePath` as it existed at `commitSha`.
//
// `commitSha` may be a 7-char short SHA (the form `dennoh history` prints) or a
// full oid. `expandOid` resolves either to a full oid and doubles as the
// commit-existence check: a prefix that matches no object throws NotFoundError,
// which we surface as a clear "commit does not exist" message. `readBlob` then
// distinguishes "the file was not present in that commit" as its own message.
export async function gitShow(
  vaultPath: string,
  filePath: string,
  commitSha: string
): Promise<string> {
  const relativePath = toRelative(vaultPath, filePath);

  let oid: string;
  try {
    oid = await git.expandOid({ fs, dir: vaultPath, oid: commitSha });
  } catch (cause) {
    if (isNotFoundError(cause)) {
      throw new Error(
        `commit ${JSON.stringify(commitSha)} does not exist in vault ${JSON.stringify(vaultPath)}`,
        { cause }
      );
    }
    throw cause;
  }

  let blob: Uint8Array;
  try {
    const result = await git.readBlob({ fs, dir: vaultPath, oid, filepath: relativePath });
    blob = result.blob;
  } catch (cause) {
    if (isNotFoundError(cause)) {
      throw new Error(
        `file ${JSON.stringify(relativePath)} does not exist in commit ${JSON.stringify(commitSha)}`,
        { cause }
      );
    }
    throw cause;
  }

  // The blob is raw bytes; notes are UTF-8 markdown, so decode accordingly.
  return new TextDecoder("utf-8").decode(blob);
}
