import type { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { readNote } from "@/core/file";
import { DENNOH_DIR, isNotePath } from "@/core/path";
import { translateJaToEn } from "@/translate";

import { toNoteRow } from "./mapper";
import type { TranslatorFn } from "./reindex";
import { deleteNote, getAllNotes, insertNote, updateNote } from "./repository";

export type SyncResult = {
  added: number;
  updated: number;
  deleted: number;
  errors: { path: string; message: string }[];
  // See `ReindexResult.translationErrors` — same semantics: thrown
  // translator errors land here so operational tooling can distinguish
  // translation outages from actual data-pipeline failures.
  translationErrors: { path: string; message: string }[];
};

// Walker variant that also returns mtime so the diff loop can decide whether
// a file needs re-reading without a second `stat` pass.
// I/O errors for individual directories or files are caught and recorded in
// `errors`; walking continues for remaining entries so one bad path does not
// abort the full scan.
async function* walkMdFilesWithStats(
  root: string,
  errors: SyncResult["errors"]
): AsyncIterable<{ path: string; mtimeMs: number }> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push({ path: root, message });
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === DENNOH_DIR) {
        continue;
      }
      yield* walkMdFilesWithStats(full, errors);
    } else if (entry.isFile() && isNotePath(full)) {
      try {
        const stats = await fs.promises.stat(full);
        yield { path: full, mtimeMs: stats.mtimeMs };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ path: full, message });
      }
    }
  }
}

export async function scanAndSync(
  db: Database,
  vaultPath: string,
  translate: TranslatorFn = translateJaToEn
): Promise<SyncResult> {
  // Pull the FS view first so we have a stable snapshot before touching the
  // DB; reading both then diffing minimizes the time window where external
  // writes during scan could be missed.
  const errors: SyncResult["errors"] = [];
  const translationErrors: SyncResult["translationErrors"] = [];
  const fsFiles = new Map<string, number>();
  for await (const file of walkMdFilesWithStats(vaultPath, errors)) {
    fsFiles.set(file.path, file.mtimeMs);
  }

  const dbRows = getAllNotes(db);
  const dbByPath = new Map(dbRows.map((r) => [r.path, r]));

  let added = 0;
  let updated = 0;
  let deleted = 0;

  // mtime > updated_at is the documented diff signal. Note that this can
  // flag an unchanged file as "updated" right after first INSERT because
  // mtime reflects the write moment while updated_at reflects the
  // frontmatter timestamp — by design the cost is one extra re-read, never
  // data loss, so we accept the redundancy at this phase.
  for (const [filePath, mtimeMs] of fsFiles) {
    const existing = dbByPath.get(filePath);
    if (existing === undefined) {
      try {
        const { id, frontmatter, body } = await readNote(filePath);
        // Translate on insert so externally-added files land with both
        // body and body_en populated. Throws from the injected translator
        // are recorded, the row still lands with body_en="".
        let bodyEn = "";
        try {
          bodyEn = await translate(body);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          translationErrors.push({ path: filePath, message });
        }
        insertNote(db, toNoteRow({ ...frontmatter, id }, filePath, body, bodyEn));
        added++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ path: filePath, message });
      }
      continue;
    }
    const updatedAtMs = Date.parse(existing.updated_at);
    if (Number.isNaN(updatedAtMs) || mtimeMs > updatedAtMs) {
      try {
        const { id, frontmatter, body } = await readNote(filePath);
        // Re-translate only when the body actually changed. mtime bumps
        // can fire on touch / metadata-only edits, and translation is the
        // expensive part of an UPDATE — comparing against the DB-stored
        // body lets us reuse the existing body_en when the source text
        // is byte-identical.
        let bodyEn = existing.body_en;
        if (body !== existing.body) {
          try {
            bodyEn = await translate(body);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            translationErrors.push({ path: filePath, message });
            bodyEn = "";
          }
        }
        updateNote(db, toNoteRow({ ...frontmatter, id }, filePath, body, bodyEn));
        updated++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ path: filePath, message });
      }
    }
  }

  // Deletions: DB rows whose backing file is gone from disk.
  for (const row of dbRows) {
    if (fsFiles.has(row.path)) {
      continue;
    }
    try {
      deleteNote(db, row.id);
      deleted++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ path: row.path, message });
    }
  }

  return { added, updated, deleted, errors, translationErrors };
}
