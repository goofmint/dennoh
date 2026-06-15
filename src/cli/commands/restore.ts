import type { CliIO } from "@/cli/types";
import { readConfig } from "@/config";
import { extractMentions } from "@/core/extract";
import { writeFileAtomic } from "@/core/file";
import { parseFrontmatter, serializeFrontmatter, updateFrontmatter } from "@/core/frontmatter";
import { closeDatabase, getNoteById, openDatabase, updateNote } from "@/db";
import { toNoteRow } from "@/db/mapper";
import { gitAdd, gitCommit, gitShow } from "@/git";

function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// `dennoh restore <id> <commitSha>` — overwrite a note with the version of it
// captured in an earlier commit, then record that restore as a new commit.
// The note stays at its existing on-disk path and keeps its id; only the
// content, mentions, and updatedAt change, mirroring a normal edit.
export async function restoreCommand(args: string[], io: CliIO): Promise<number> {
  const id = args[0];
  const commitSha = args[1];
  if (!id || !commitSha) {
    io.stderr("Usage: dennoh restore <id> <commitSha>\n");
    return 1;
  }

  let vaultPath: string;
  try {
    vaultPath = readConfig().vaultPath;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  }

  const db = openDatabase(vaultPath);
  try {
    // getNoteById filters `deleted_at IS NULL`: restoring onto a soft-deleted
    // or unknown note is rejected here. We resolve the path from the DB row so
    // the file is written back exactly where it already lives.
    const row = getNoteById(db, id);
    if (row === null) {
      io.stderr(`note not found or already deleted (id=${id})\n`);
      return 1;
    }
    const filePath = row.path;

    // gitShow throws a precise error for a bad commit SHA or a path absent
    // from that commit; both surface to the user as a failed restore.
    const restoredContent = await gitShow(vaultPath, filePath, commitSha);

    // The committed blob is a full note file. Re-parse it and re-extract
    // mentions from the restored body so projects/tags reflect the restored
    // content (not whatever the live row last held).
    const { frontmatter, body } = parseFrontmatter(restoredContent);
    const { projects, tags } = extractMentions(body);
    const nextFrontmatter = updateFrontmatter(
      frontmatter,
      { projects, tags },
      { bumpUpdatedAt: true }
    );

    // Write back to the existing path directly rather than via `writeNote`.
    // `writeNote` re-derives the YYYY/MM/DD directory from createdAt through
    // local-timezone Date getters, which can place the file in a different
    // directory than the original across a DST/timezone shift. Using the
    // stored `path` keeps the note in place by construction — the same
    // reasoning `updateMemory` documents for in-place edits.
    await writeFileAtomic(filePath, serializeFrontmatter(nextFrontmatter, body));

    // Reset body_en to "": the restored body differs from the live one, so the
    // previous translation no longer applies. It is left empty until a later
    // edit (or reindex) repopulates it rather than serving a stale translation.
    const metadata = { ...nextFrontmatter, id };
    updateNote(db, toNoteRow(metadata, filePath, body, ""));

    // Record the restore as an ordinary edit so history stays linear and the
    // `update <id>` convention from the CRUD path is preserved.
    await gitAdd(vaultPath, filePath);
    await gitCommit(vaultPath, `update ${id}`);

    io.stdout(`restored ${id} from ${commitSha.slice(0, 7)}\n`);
    return 0;
  } catch (e) {
    io.stderr(`${readError(e)}\n`);
    return 1;
  } finally {
    closeDatabase(db);
  }
}
