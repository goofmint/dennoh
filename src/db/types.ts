import type { NoteSource } from "@/core/types";

// Row layout for the `notes` table. Column names mirror SQL (snake_case)
// so reads from `bun:sqlite` can be assigned without renaming. JSON columns
// are stored as serialized arrays; deserialization is the caller's
// responsibility (see `projects_json` / `tags_json`).
export type NoteRow = {
  id: string;
  path: string;
  created_at: string;
  updated_at: string;
  source: NoteSource;
  title: string | null;
  projects_json: string;
  tags_json: string;
};

// Search result shape used by T6 (`searchMemory`). Defined here so the
// search implementation can import a stable contract without circular deps
// back into the search module. Fields mirror requirements 7-3 / 7-7.
export type NoteSearchResult = {
  id: string;
  path: string;
  title: string | null;
  snippet: string;
  createdAt: string;
  updatedAt: string;
  source: NoteSource;
  projects: string[];
  tags: string[];
};

// Aggregate counters exposed by `status()` (T10.10) and the CLI `status` cmd.
// `lastUpdatedAt` is the max `updated_at` across `notes`, or null when empty.
export type IndexStats = {
  noteCount: number;
  lastUpdatedAt: string | null;
};
