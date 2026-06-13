import * as fs from "node:fs";
import * as path from "node:path";

import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";
import { buildNotePath, parseIdFromPath } from "./path";
import type { NoteFrontmatter } from "./types";
import { isValidUuid } from "./uuid";

function assertValidNoteId(id: string, context: string): void {
  if (!isValidUuid(id)) {
    throw new Error(`Note id at ${context} is not a valid UUID v7: ${JSON.stringify(id)}`);
  }
}

export type NoteRead = {
  id: string;
  frontmatter: NoteFrontmatter;
  body: string;
};

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmpPath = path.join(dir, `.tmp.${crypto.randomUUID()}`);
  try {
    await fs.promises.writeFile(tmpPath, content);
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      // best-effort cleanup; surface the original error
    }
    throw e;
  }
}

export async function readNote(filePath: string): Promise<NoteRead> {
  const id = parseIdFromPath(filePath);
  if (id === null) {
    throw new Error(`Not a note path (expected .md extension): ${filePath}`);
  }
  assertValidNoteId(id, filePath);
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, "utf-8");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read note ${filePath}: ${detail}`);
  }
  const { frontmatter, body } = parseFrontmatter(content);
  return { id, frontmatter, body };
}

export async function writeNote(
  vaultPath: string,
  id: string,
  date: Date,
  frontmatter: NoteFrontmatter,
  body: string
): Promise<string> {
  assertValidNoteId(id, "writeNote");
  const filePath = buildNotePath(vaultPath, id, date);
  const content = serializeFrontmatter(frontmatter, body);
  await writeFileAtomic(filePath, content);
  return filePath;
}
