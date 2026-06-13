import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { DENNOH_DIR } from "@/core/path";

const INDEX_DB_FILENAME = "index.db";

// Single-file SQLite layout for `openDatabase`.
//
// We intentionally keep the SQLite default journal mode (DELETE) instead of
// enabling WAL. The vault lives in user-visible storage (potentially iCloud /
// Dropbox / OneDrive) and a future mobile client is expected to open the same
// `.db` directly. WAL spawns `index.db-wal` and `index.db-shm` sidecar files
// that those sync engines and mobile sqlite consumers handle poorly: lost
// commits, corruption, or a forced checkpoint cycle on every open. DELETE
// mode keeps the database in a single file at the cost of some write
// concurrency, which is acceptable for the dennoh workload.
export function openDatabase(vaultPath: string): Database {
  const dennohDir = path.join(vaultPath, DENNOH_DIR);
  try {
    fs.mkdirSync(dennohDir, { recursive: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to create dennoh directory at ${dennohDir}: ${detail}`);
  }

  const dbPath = path.join(dennohDir, INDEX_DB_FILENAME);
  let db: Database;
  try {
    db = new Database(dbPath, { create: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to open SQLite database at ${dbPath}: ${detail}`);
  }

  // Foreign key enforcement is per-connection in SQLite; set it here so every
  // caller gets the same behavior regardless of pragma defaults.
  try {
    db.exec("PRAGMA foreign_keys = ON;");
  } catch (e) {
    db.close();
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to enable foreign_keys on ${dbPath}: ${detail}`);
  }

  return db;
}

export function closeDatabase(db: Database): void {
  db.close();
}
