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

// toNoteRow: NoteMetadata + path + body + bodyEn → notes table row.
//
// `body` is the original (typically Japanese) note body. `bodyEn` is the
// JA→EN machine translation produced by `@/translate`, or "" when
// translation is disabled / failed / skipped (non-Japanese content). Both
// land in their respective columns and feed `notes_fts` for search.
export function toNoteRow(
  metadata: NoteMetadata,
  path: string,
  body: string,
  bodyEn: string
): NoteRow {
  return {
    id: metadata.id,
    path,
    created_at: metadata.createdAt,
    updated_at: metadata.updatedAt,
    source: metadata.source,
    title: metadata.title ?? null,
    projects_json: JSON.stringify(metadata.projects),
    tags_json: JSON.stringify(metadata.tags),
    body,
    body_en: bodyEn,
  };
}

// fromNoteRow: notes row → { metadata, path, body, body_en }.
// `body` / `body_en` are surfaced because v3 stores them on the row directly
// (they are no longer "live only in the .md file"). Callers that only need
// the path / metadata can ignore them; structural compatibility with the
// pre-v3 return is preserved by additive widening.
export function fromNoteRow(row: NoteRow): {
  metadata: NoteMetadata;
  path: string;
  body: string;
  body_en: string;
} {
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
    body: row.body,
    body_en: row.body_en,
  };
}
