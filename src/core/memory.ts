import type { Database } from "bun:sqlite";
import * as fs from "node:fs";

import { readConfig } from "@/config";
import { fromNoteRow, toNoteRow } from "@/db/mapper";
import { getAllNotes, getNoteById, insertNote, softDeleteNote, updateNote } from "@/db/repository";
import type { NoteRow } from "@/db/types";
import { gitAdd, gitCommit, gitRemove } from "@/git/commit";

import { extractMentions } from "./extract";
import { type NoteRead, readNote, writeFileAtomic, writeNote } from "./file";
import { isoWithLocalOffset, serializeFrontmatter, updateFrontmatter } from "./frontmatter";
import type { NoteFrontmatter, NoteSource } from "./types";
import { generateId } from "./uuid";
import { validateContent } from "./validate";

const DEFAULT_RECENT_LIMIT = 10;

// Failure model across saveMemory / updateMemory / deleteMemory:
//
// Each operation runs file → DB → git sequentially without compensating
// transactions. If a later step throws, earlier side effects remain. This is
// acceptable for v0.1 because `scanAndSync` (startup diff) reconciles
// file vs DB state, and `gitCommit` can be retried on the next save without
// data loss. We do NOT swallow inner errors — the caller is told what failed.

export async function saveMemory(
  db: Database,
  vaultPath: string,
  content: string,
  source: NoteSource = "note"
): Promise<string> {
  const { maxFileSizeBytes } = readConfig();
  // maxFileSizeBytes is filled in by readConfig from DEFAULT_CONFIG, but
  // narrow once so TypeScript is satisfied that downstream uses are number.
  if (maxFileSizeBytes === undefined) {
    throw new Error("saveMemory: config.maxFileSizeBytes resolved to undefined");
  }
  validateContent(content, maxFileSizeBytes);

  const id = generateId();
  const { projects, tags } = extractMentions(content);
  const now = new Date();
  const timestamp = isoWithLocalOffset(now);

  const frontmatter: NoteFrontmatter = {
    createdAt: timestamp,
    updatedAt: timestamp,
    source,
    projects,
    tags,
  };

  const filePath = await writeNote(vaultPath, id, now, frontmatter, content);

  const metadata = { ...frontmatter, id };
  insertNote(db, toNoteRow(metadata, filePath, content));

  await gitAdd(vaultPath, filePath);
  await gitCommit(vaultPath, `add ${id}`);

  return id;
}

export async function updateMemory(
  db: Database,
  vaultPath: string,
  id: string,
  content: string
): Promise<void> {
  const { maxFileSizeBytes } = readConfig();
  if (maxFileSizeBytes === undefined) {
    throw new Error("updateMemory: config.maxFileSizeBytes resolved to undefined");
  }
  validateContent(content, maxFileSizeBytes);

  // getNoteById already filters `deleted_at IS NULL`, so a hit here is by
  // construction a live note — the literal step "throw if deleted_at != NULL"
  // in the task is unreachable and intentionally omitted.
  const row = getNoteById(db, id);
  if (row === null) {
    throw new Error(`updateMemory: note not found or already deleted (id=${id})`);
  }

  const { path: filePath } = fromNoteRow(row);
  const existing = await readNote(filePath);

  const { projects, tags } = extractMentions(content);
  const nextFrontmatter = updateFrontmatter(
    existing.frontmatter,
    { projects, tags },
    { bumpUpdatedAt: true }
  );

  // Write back to the existing path directly. We avoid `writeNote`'s
  // buildNotePath derivation because it would re-derive the YYYY/MM/DD
  // segment from createdAt via local-timezone Date getters, which can flip
  // the directory across a DST or timezone change relative to the original
  // write. Using the stored `path` keeps the file in place by construction.
  await writeFileAtomic(filePath, serializeFrontmatter(nextFrontmatter, content));

  const metadata = { ...nextFrontmatter, id };
  updateNote(db, toNoteRow(metadata, filePath, content));

  await gitAdd(vaultPath, filePath);
  await gitCommit(vaultPath, `update ${id}`);
}

// Read-side helpers below: no git, no validation, no writes.

// getNote resolves an id to disk content. `vaultPath` is accepted as part of
// the public read API so the signature is symmetric with the write helpers,
// even though the resolved file path is taken from the DB row rather than
// re-derived from `vaultPath` — that way a moved vault directory does not
// strand the lookup as long as the DB and files are still in sync.
export async function getNote(
  db: Database,
  _vaultPath: string,
  id: string
): Promise<NoteRead | null> {
  const row = getNoteById(db, id);
  if (row === null) {
    return null;
  }
  const { path: filePath } = fromNoteRow(row);
  return await readNote(filePath);
}

// listRecent surfaces the most-recently-updated live notes for the CLI / MCP
// `list_recent` endpoint. The DB query already enforces `deleted_at IS NULL`
// and `ORDER BY updated_at DESC`, so this just bounds the result. We return
// raw NoteRow rather than reading bodies from disk because the recent-list
// view is metadata-only — callers that need bodies pair this with `getNote`.
export function listRecent(db: Database, limit: number = DEFAULT_RECENT_LIMIT): NoteRow[] {
  return getAllNotes(db).slice(0, limit);
}

export async function deleteMemory(db: Database, vaultPath: string, id: string): Promise<void> {
  // Same as updateMemory: live filter is enforced by the SELECT, so missing
  // and soft-deleted collapse into one "not found" message — the caller
  // does not need to distinguish them for the v0.1 surface.
  const row = getNoteById(db, id);
  if (row === null) {
    throw new Error(`deleteMemory: note not found or already deleted (id=${id})`);
  }

  const { path: filePath } = fromNoteRow(row);

  // `force: true` makes the unlink idempotent: if the backing file was
  // already removed externally (sync race, manual rm), we still proceed to
  // stamp `deleted_at` and record the git history. The goal of delete is the
  // post-condition "file is gone", not the imperative "perform an unlink".
  fs.rmSync(filePath, { force: true });
  softDeleteNote(db, id);

  await gitRemove(vaultPath, filePath);
  await gitCommit(vaultPath, `delete ${id}`);
}
