import type { NoteFrontmatter, NoteMetadata, NoteSource } from "@/core/types";

import type { NoteRow } from "./types";

const VALID_SOURCES: ReadonlySet<NoteSource> = new Set<NoteSource>(["note"]);

function ensureStringArray(parsed: unknown, column: keyof NoteRow): string[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${column} to deserialize into a JSON array.`);
  }
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new Error(`Expected every ${column} entry to be a string.`);
    }
  }
  return parsed as string[];
}

function parseSource(value: string): NoteSource {
  // VALID_SOURCES is the runtime mirror of the NoteSource union. Without the
  // explicit cast the `has` predicate would be too narrow and source would
  // not flow back into NoteSource on the success path.
  if (!VALID_SOURCES.has(value as NoteSource)) {
    throw new Error(`Unknown note source in row: ${JSON.stringify(value)}`);
  }
  return value as NoteSource;
}

// toNoteRow: NoteMetadata + path + body → notes table row.
//
// `body` is accepted for forward compatibility — eventually the FTS index will
// carry body tokens (T6 search) and this mapper will project them into a
// `notes_fts` payload. Today, `notes` has no body column and `notes_fts` only
// indexes `title`, so the parameter is retained at the API boundary but not
// stored. Prefixing with `_` satisfies tsconfig `noUnusedParameters`.
export function toNoteRow(metadata: NoteMetadata, path: string, _body: string): NoteRow {
  return {
    id: metadata.id,
    path,
    created_at: metadata.createdAt,
    updated_at: metadata.updatedAt,
    source: metadata.source,
    title: metadata.title ?? null,
    projects_json: JSON.stringify(metadata.projects),
    tags_json: JSON.stringify(metadata.tags),
  };
}

// fromNoteRow: notes row → { metadata, path }.
// The body is intentionally not returned because it lives in the .md file on
// disk, not in `notes`; callers that need it pair this with `readNote`.
export function fromNoteRow(row: NoteRow): { metadata: NoteMetadata; path: string } {
  const projects = ensureStringArray(JSON.parse(row.projects_json), "projects_json");
  const tags = ensureStringArray(JSON.parse(row.tags_json), "tags_json");
  const source = parseSource(row.source);

  const frontmatter: NoteFrontmatter = {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source,
    projects,
    tags,
  };
  if (row.title !== null) {
    frontmatter.title = row.title;
  }

  return {
    metadata: { ...frontmatter, id: row.id },
    path: row.path,
  };
}
