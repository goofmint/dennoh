import type { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { readNote } from "@/core/file";
import { DENNOH_DIR, isNotePath } from "@/core/path";

import { toNoteRow } from "./mapper";
import { insertNote } from "./repository";

export type ReindexResult = {
  processed: number;
  errors: { path: string; message: string }[];
};

// Recursive .md walker. `.dennoh/` is the only excluded directory at this
// phase per spec; broader hidden-file exclusion (.git, .obsidian, .DS_Store)
// arrives with T7.5 and will replace this set.
async function* walkMdFiles(root: string): AsyncIterable<string> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === DENNOH_DIR) {
        continue;
      }
      yield* walkMdFiles(full);
    } else if (entry.isFile() && isNotePath(full)) {
      yield full;
    }
  }
}

export async function reindexAll(db: Database, vaultPath: string): Promise<ReindexResult> {
  // DELETE FROM notes fires the AFTER DELETE trigger for each row, which
  // removes the matching FTS entries. We do NOT wrap the full reindex in a
  // transaction because the spec mandates "record errors and continue" — a
  // single bad file should not roll back successful inserts.
  db.exec("DELETE FROM notes;");

  const errors: ReindexResult["errors"] = [];
  let processed = 0;

  for await (const filePath of walkMdFiles(vaultPath)) {
    try {
      const { id, frontmatter, body } = await readNote(filePath);
      const row = toNoteRow({ ...frontmatter, id }, filePath, body);
      insertNote(db, row);
      processed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ path: filePath, message });
    }
  }

  return { processed, errors };
}
