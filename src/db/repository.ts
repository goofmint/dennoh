import type { Database } from "bun:sqlite";

import type { NoteRow } from "./types";

const INSERT_SQL = `
  INSERT INTO notes (
    id, path, created_at, updated_at, source, title, projects_json, tags_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SQL = `
  UPDATE notes SET
    path = ?,
    created_at = ?,
    updated_at = ?,
    source = ?,
    title = ?,
    projects_json = ?,
    tags_json = ?
  WHERE id = ?
`;

const DELETE_SQL = "DELETE FROM notes WHERE id = ?";

const SELECT_BY_ID_SQL = `
  SELECT id, path, created_at, updated_at, source, title, projects_json, tags_json
  FROM notes WHERE id = ?
`;

const SELECT_ALL_SQL = `
  SELECT id, path, created_at, updated_at, source, title, projects_json, tags_json
  FROM notes
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
      note.tags_json
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

export function getNoteById(db: Database, id: string): NoteRow | null {
  return db.query<NoteRow, [string]>(SELECT_BY_ID_SQL).get(id) ?? null;
}

export function getAllNotes(db: Database): NoteRow[] {
  return db.query<NoteRow, []>(SELECT_ALL_SQL).all();
}
