export type NoteSource = "note";

export type NoteFrontmatter = {
  createdAt: string;
  updatedAt: string;
  source: NoteSource;
  title?: string;
  projects: string[];
  tags: string[];
};

export type NoteMetadata = NoteFrontmatter & {
  id: string;
};
