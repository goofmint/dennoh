import type { NoteRow } from "@/db";
import { fromNoteRow } from "@/db/mapper";

// JSON-friendly projection of a stored note: identity + path + frontmatter,
// without the indexed body / body_en columns. Shared by the tools that return
// note metadata (save / update / list_recent) so the shape stays consistent.
export type NoteMetadataDto = {
  id: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  title: string | null;
  projects: string[];
  tags: string[];
};

export function noteMetadata(row: NoteRow): NoteMetadataDto {
  const { metadata, path } = fromNoteRow(row);
  return {
    id: metadata.id,
    path,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    source: metadata.source,
    title: metadata.title ?? null,
    projects: metadata.projects,
    tags: metadata.tags,
  };
}
