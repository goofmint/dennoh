import type { Database } from "bun:sqlite";
import * as fs from "node:fs";

import { readConfig } from "@/config";
import { fromNoteRow, toNoteRow } from "@/db/mapper";
import {
  getAllNotes,
  getNoteById,
  insertNote,
  searchNotes,
  softDeleteNote,
  updateNote,
} from "@/db/repository";
import type { NoteRow, NoteSearchResult, SearchFilters } from "@/db/types";
import { gitAdd, gitCommit, gitRemove } from "@/git/commit";
import { translateJaToEn } from "@/translate";

import { extractMentions } from "./extract";
import { type NoteRead, readNote, writeFileAtomic, writeNote } from "./file";
import { isoWithLocalOffset, serializeFrontmatter, updateFrontmatter } from "./frontmatter";
import type { NoteFrontmatter, NoteSource } from "./types";
import { generateId } from "./uuid";
import { validateContent } from "./validate";

const DEFAULT_RECENT_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 20;

// Failure model across saveMemory / updateMemory / deleteMemory:
//
// Each operation runs file → DB → git sequentially without compensating
// transactions. If a later step throws, earlier side effects remain. This is
// acceptable for v0.1 because `scanAndSync` (startup diff) reconciles
// file vs DB state, and `gitCommit` can be retried on the next save without
// data loss. We do NOT swallow inner errors — the caller is told what failed.

// Background JA→EN translation. Called after gitCommit has resolved so the
// save returns to the caller immediately; the translation pipeline (model
// load + inference) can take seconds on a cold start and must not block the
// user-visible operation.
//
// Safety properties:
//   - Errors are swallowed via `.catch()` so the floating Promise never
//     surfaces as an unhandled rejection. The translator itself absorbs
//     failures into "" by design; the catch is for any pathological throw.
//   - Returns "" → no DB update. We never overwrite an existing body_en
//     with empty string, so prior translations survive a disable/failure.
//   - `WHERE body = ?` on the UPDATE guards against stale writes: if the
//     row's body changed between the snapshot we translated and the time
//     the background task completes, the UPDATE matches zero rows and is
//     a silent no-op — the next save's translation will repopulate.
//
// The promise is returned so test code can `await` it; production callers
// invoke via `void scheduleBodyEnUpdate(...)`.
function scheduleBodyEnUpdate(db: Database, id: string, content: string): Promise<void> {
  return translateJaToEn(content)
    .then((bodyEn) => {
      if (bodyEn.length === 0) {
        return;
      }
      db.query("UPDATE notes SET body_en = ? WHERE id = ? AND body = ?").run(bodyEn, id, content);
    })
    .catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[dennoh translate] background body_en update failed for id=${id}: ${detail}\n`
      );
    });
}

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

  // Insert immediately with body_en = "". The model-load + inference path
  // can take many seconds on a cold start; blocking the save on it would
  // make CLI / MCP save latency unpredictable. The row is searchable by
  // title and body right away; `scheduleBodyEnUpdate` patches body_en
  // after gitCommit returns.
  const metadata = { ...frontmatter, id };
  insertNote(db, toNoteRow(metadata, filePath, content, ""));

  await gitAdd(vaultPath, filePath);
  await gitCommit(vaultPath, `add ${id}`);

  // Fire-and-forget. Not awaited — the caller gets `id` immediately.
  void scheduleBodyEnUpdate(db, id, content);

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

  // Keep the previous translation synchronously. body_en is stale relative
  // to the new content until the background task completes, but that's
  // preferable to either (a) blocking the update on translation latency,
  // or (b) clearing body_en to "" mid-update and losing cross-language
  // searchability in the gap. The background task patches body_en once
  // the new translation lands.
  const metadata = { ...nextFrontmatter, id };
  updateNote(db, toNoteRow(metadata, filePath, content, row.body_en));

  await gitAdd(vaultPath, filePath);
  await gitCommit(vaultPath, `update ${id}`);

  void scheduleBodyEnUpdate(db, id, content);
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

// Thin wrapper around the db-layer `searchNotes`. The core layer carries the
// product default (20) so the CLI / MCP boundary doesn't have to hardcode it,
// and limit validation is delegated downstream so the policy lives in one
// place. Filter shape and result shape are pass-through.
export function searchMemory(
  db: Database,
  query: string,
  filters?: SearchFilters,
  limit: number = DEFAULT_SEARCH_LIMIT
): NoteSearchResult[] {
  return searchNotes(db, query, filters, limit);
}

// listRecent surfaces the most-recently-updated live notes for the CLI / MCP
// `list_recent` endpoint. The DB query already enforces `deleted_at IS NULL`
// and `ORDER BY updated_at DESC`, so this just bounds the result. We return
// raw NoteRow rather than reading bodies from disk because the recent-list
// view is metadata-only — callers that need bodies pair this with `getNote`.
//
// `limit` is validated here because TypeScript types are compile-time only;
// `Array.prototype.slice` silently mis-handles negatives (drops trailing
// rows) and NaN (returns empty), so a bad value would produce a confusing
// result rather than a clear error. The CLI / MCP boundary normally cleans
// inputs, but this function is reachable from any future caller and the
// guard is cheap.
export function listRecent(db: Database, limit: number = DEFAULT_RECENT_LIMIT): NoteRow[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listRecent: limit must be a positive integer (got ${limit})`);
  }
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
