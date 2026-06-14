// Public API of the dennoh database layer.
//
// Anything not re-exported here (mapper, getAllNotes, getCurrentVersion,
// schema internals) is considered an implementation detail and may change
// without notice. Tests that exercise internals may still import the
// individual modules directly.
export type { IndexStats, NoteRow, NoteSearchResult, SearchFilters } from "./types";
export { closeDatabase, openDatabase } from "./connection";
export { runMigrations } from "./schema";
export {
  deleteNote,
  getNoteById,
  insertNote,
  searchNotes,
  softDeleteNote,
  updateNote,
} from "./repository";
export { type ReindexResult, reindexAll } from "./reindex";
export { type SyncResult, scanAndSync } from "./sync";
