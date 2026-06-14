import type { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { readNote } from "@/core/file";
import { DENNOH_DIR, isNotePath } from "@/core/path";
import { translateJaToEn } from "@/translate";

import { toNoteRow } from "./mapper";
import { insertNote } from "./repository";

export type ReindexResult = {
  processed: number;
  errors: { path: string; message: string }[];
  // Separate bucket for translator-side failures so that callers (CLI /
  // MCP status) can surface "translation backed off" distinctly from
  // "could not read or insert the note". The default `translateJaToEn`
  // never throws (it absorbs to ""), so production runs typically leave
  // this empty; entries appear when a custom translator throws or when a
  // future translator is rewritten to surface errors explicitly.
  translationErrors: { path: string; message: string }[];
};

// `translateJaToEn` is the production translator (singleton model, env-var
// disable, "" on failure). Reindex / sync accept a `translate` function via
// DI so tests can substitute a deterministic mock without touching env vars
// or module-level singletons. Callers in the production path leave the
// default in place.
export type TranslatorFn = (text: string) => Promise<string>;

// Recursive .md walker. `.dennoh/` is the only excluded directory at this
// phase per spec; broader hidden-file exclusion (.git, .obsidian, .DS_Store)
// arrives with T7.5 and will replace this set.
// I/O errors for individual directories are caught and recorded in `errors`;
// walking continues for all other entries so one bad directory does not abort
// the full reindex.
async function* walkMdFiles(root: string, errors: ReindexResult["errors"]): AsyncIterable<string> {
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
      yield* walkMdFiles(full, errors);
    } else if (entry.isFile() && isNotePath(full)) {
      yield full;
    }
  }
}

export async function reindexAll(
  db: Database,
  vaultPath: string,
  translate: TranslatorFn = translateJaToEn
): Promise<ReindexResult> {
  // DELETE FROM notes fires the AFTER DELETE trigger for each row, which
  // removes the matching FTS entries. We do NOT wrap the full reindex in a
  // transaction because the spec mandates "record errors and continue" — a
  // single bad file should not roll back successful inserts.
  db.exec("DELETE FROM notes;");

  const errors: ReindexResult["errors"] = [];
  const translationErrors: ReindexResult["translationErrors"] = [];
  let processed = 0;

  for await (const filePath of walkMdFiles(vaultPath, errors)) {
    try {
      const { id, frontmatter, body } = await readNote(filePath);
      // Translate inline so legacy rows (body_en="" from a v2→v3 upgrade
      // or a previously offline save) get their English index restored.
      // The default `translateJaToEn` returns "" on failure / disable /
      // offline (never throws), so production runs land in the success
      // branch with bodyEn = "" for absorbed failures. Custom translators
      // (DI / future implementations) may throw — we keep the row in the
      // result with bodyEn = "" and record the throw for later inspection.
      let bodyEn = "";
      try {
        bodyEn = await translate(body);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        translationErrors.push({ path: filePath, message });
      }
      const row = toNoteRow({ ...frontmatter, id }, filePath, body, bodyEn);
      insertNote(db, row);
      processed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ path: filePath, message });
    }
  }

  return { processed, errors, translationErrors };
}
