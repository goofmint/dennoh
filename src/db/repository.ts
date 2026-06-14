import type { Database } from "bun:sqlite";

import type { NoteSource } from "@/core/types";

import type { NoteRow, NoteSearchResult, SearchFilters } from "./types";

const INSERT_SQL = `
  INSERT INTO notes (
    id, path, created_at, updated_at, source, title, projects_json, tags_json, body, body_en
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SQL = `
  UPDATE notes SET
    path = ?,
    created_at = ?,
    updated_at = ?,
    source = ?,
    title = ?,
    projects_json = ?,
    tags_json = ?,
    body = ?,
    body_en = ?
  WHERE id = ?
`;

const DELETE_SQL = "DELETE FROM notes WHERE id = ?";

const SOFT_DELETE_SQL = "UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL";

// `deleted_at IS NULL` is the live-row filter that the v2 migration introduced.
// `getNoteById` / `getAllNotes` hide soft-deleted rows so callers cannot
// accidentally surface a tombstoned note; for true purge or test cleanup use
// `deleteNote` directly. Selects include `body` / `body_en` (added in v3) so
// downstream code can read the indexed content without touching disk.
const SELECT_BY_ID_SQL = `
  SELECT id, path, created_at, updated_at, source, title, projects_json, tags_json, body, body_en
  FROM notes WHERE id = ? AND deleted_at IS NULL
`;

const SELECT_ALL_SQL = `
  SELECT id, path, created_at, updated_at, source, title, projects_json, tags_json, body, body_en
  FROM notes
  WHERE deleted_at IS NULL
  ORDER BY updated_at DESC
`;

// All mutations run inside a transaction. The notes_fts sync triggers defined
// in the v1 migration fire as part of the same transaction, so a rolled-back
// INSERT/UPDATE/DELETE leaves both tables untouched — no half-state where the
// FTS index disagrees with `notes`.
export function insertNote(db: Database, note: NoteRow): void {
  const stmt = db.query(INSERT_SQL);
  const tx = db.transaction(() => {
    stmt.run(
      note.id,
      note.path,
      note.created_at,
      note.updated_at,
      note.source,
      note.title,
      note.projects_json,
      note.tags_json,
      note.body,
      note.body_en
    );
  });
  tx();
}

// updateNote requires the caller to pass an already-bumped `updated_at`.
// The repository does not stamp it implicitly because the source of truth is
// the frontmatter on disk; auto-overwriting here would race with the file
// writer and yield a stricter timestamp than the persisted note shows.
export function updateNote(db: Database, note: NoteRow): void {
  const stmt = db.query(UPDATE_SQL);
  const tx = db.transaction(() => {
    const result = stmt.run(
      note.path,
      note.created_at,
      note.updated_at,
      note.source,
      note.title,
      note.projects_json,
      note.tags_json,
      note.body,
      note.body_en,
      note.id
    );
    if (result.changes === 0) {
      throw new Error(`updateNote: no row found for id ${JSON.stringify(note.id)}`);
    }
  });
  tx();
}

export function deleteNote(db: Database, id: string): void {
  const stmt = db.query(DELETE_SQL);
  const tx = db.transaction(() => {
    stmt.run(id);
  });
  tx();
}

// Soft delete: keep the row, stamp `deleted_at` so live reads skip it. The
// timestamp is generated here (not by the caller) because soft-delete time
// is a DB-bookkeeping concern, distinct from the frontmatter `updated_at`
// which reflects user-visible edits.
export function softDeleteNote(db: Database, id: string): void {
  const stmt = db.query(SOFT_DELETE_SQL);
  const tx = db.transaction(() => {
    const result = stmt.run(new Date().toISOString(), id);
    if (result.changes === 0) {
      throw new Error(`softDeleteNote: no live row found for id ${JSON.stringify(id)}`);
    }
  });
  tx();
}

export function getNoteById(db: Database, id: string): NoteRow | null {
  return db.query<NoteRow, [string]>(SELECT_BY_ID_SQL).get(id) ?? null;
}

export function getAllNotes(db: Database): NoteRow[] {
  return db.query<NoteRow, []>(SELECT_ALL_SQL).all();
}

const DEFAULT_SEARCH_LIMIT = 20;

// `_` and `%` are LIKE wildcards; `\` is the documented escape. extractMentions
// allows `_` and `-` in tag/project names, so an unescaped value like `foo_bar`
// would mis-match `fooXbar` as well. Pre-escaping these characters keeps the
// LIKE pattern semantically equivalent to an exact JSON-array-element check.
function escapeLikeValue(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function buildJsonArrayLikePattern(value: string): string {
  // `["foo"]`, `["a","foo","b"]`, etc. all contain the substring `"foo"`,
  // and the surrounding `"` delimiters prevent prefix collisions like
  // matching `["foobar"]` for the value `foo`. The wrapping `%` allows
  // arbitrary surrounding JSON content.
  return `%"${escapeLikeValue(value)}"%`;
}

// Snippet column index: 0=title, 1=body, 2=body_en (declaration order in the
// v3 migration). Per spec we snippet the body column; this gives a useful
// excerpt for both Japanese matches (against `body`) and English matches
// (the FTS still ranks correctly via the cross-column MATCH, even when the
// snippet itself comes from `body`).
const SNIPPET_EXPR = "snippet(notes_fts, 1, '<mark>', '</mark>', '...', 64)";

const SEARCH_SELECT_PREFIX = `
  SELECT
    notes.id,
    notes.path,
    notes.title,
    ${SNIPPET_EXPR} AS snippet,
    notes.created_at AS createdAt,
    notes.updated_at AS updatedAt,
    notes.source,
    notes.projects_json,
    notes.tags_json
  FROM notes_fts
  JOIN notes ON notes.rowid = notes_fts.rowid
  WHERE notes_fts MATCH ?
    AND notes.deleted_at IS NULL
`;

type SearchRow = {
  id: string;
  path: string;
  title: string | null;
  snippet: string;
  createdAt: string;
  updatedAt: string;
  source: NoteSource;
  projects_json: string;
  tags_json: string;
};

type SearchBindValue = string | number;

export function searchNotes(
  db: Database,
  query: string,
  filters?: SearchFilters,
  limit: number = DEFAULT_SEARCH_LIMIT
): NoteSearchResult[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`searchNotes: limit must be a positive integer (got ${limit})`);
  }

  // FTS MATCH is the first bind, followed by any active filter binds, ending
  // with the LIMIT bind. Order here must match the order clauses are pushed
  // onto `where`.
  const where: string[] = [];
  const binds: SearchBindValue[] = [query];

  // SQL `ESCAPE '\'` — exactly one backslash inside SQLite's quote pair.
  // In JS source that string literal needs `'\\'` (one escaped backslash).
  if (filters?.project !== undefined) {
    where.push("notes.projects_json LIKE ? ESCAPE '\\'");
    binds.push(buildJsonArrayLikePattern(filters.project));
  }
  if (filters?.tag !== undefined) {
    where.push("notes.tags_json LIKE ? ESCAPE '\\'");
    binds.push(buildJsonArrayLikePattern(filters.tag));
  }
  if (filters?.dateFrom !== undefined) {
    where.push("notes.updated_at >= ?");
    binds.push(filters.dateFrom);
  }
  if (filters?.dateTo !== undefined) {
    where.push("notes.updated_at <= ?");
    binds.push(filters.dateTo);
  }
  if (filters?.source !== undefined) {
    where.push("notes.source = ?");
    binds.push(filters.source);
  }

  const filterClauses = where.length > 0 ? `\n    AND ${where.join("\n    AND ")}` : "";
  const sql = `${SEARCH_SELECT_PREFIX}${filterClauses}\n  ORDER BY rank\n  LIMIT ?`;
  binds.push(limit);

  const rows = db.query<SearchRow, SearchBindValue[]>(sql).all(...binds);
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    title: row.title,
    snippet: row.snippet,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: row.source,
    projects: JSON.parse(row.projects_json) as string[],
    tags: JSON.parse(row.tags_json) as string[],
  }));
}
